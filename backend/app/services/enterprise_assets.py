from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.asset_models import EnterpriseAsset, EnterpriseAssetCreate
from app.core.config import Settings
from app.schemas import Coordinate
from app.services.store import HeatShieldStore


class EnterpriseAssetStore:
    """Persist enterprise infrastructure against the existing HeatShield site geometry."""

    def __init__(self, settings: Settings):
        self.path = settings.resolved_database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.site_store = HeatShieldStore(settings)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS enterprise_assets (
                    id TEXT PRIMARY KEY,
                    site_id TEXT NOT NULL,
                    asset_code TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    criticality TEXT NOT NULL DEFAULT 'medium',
                    status TEXT NOT NULL DEFAULT 'operational',
                    heat_limit_c REAL,
                    cooling_dependent INTEGER NOT NULL DEFAULT 0,
                    owner TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
                    UNIQUE(site_id, asset_code)
                );
                CREATE INDEX IF NOT EXISTS idx_enterprise_assets_site_id
                ON enterprise_assets(site_id);
            ''')

    @staticmethod
    def _point_on_segment(point: Coordinate, a: Coordinate, b: Coordinate, epsilon: float = 1e-9) -> bool:
        cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng)
        if abs(cross) > epsilon:
            return False
        return (
            min(a.lng, b.lng) - epsilon <= point.lng <= max(a.lng, b.lng) + epsilon
            and min(a.lat, b.lat) - epsilon <= point.lat <= max(a.lat, b.lat) + epsilon
        )

    @classmethod
    def _point_in_polygon(cls, point: Coordinate, polygon: list[Coordinate]) -> bool:
        if len(polygon) < 3:
            return False
        for index, current in enumerate(polygon):
            if cls._point_on_segment(point, polygon[index - 1], current):
                return True

        inside = False
        j = len(polygon) - 1
        for i, current in enumerate(polygon):
            previous = polygon[j]
            if (current.lat > point.lat) != (previous.lat > point.lat):
                denominator = previous.lat - current.lat
                if abs(denominator) > 1e-12:
                    crossing_lng = (
                        (previous.lng - current.lng) * (point.lat - current.lat) / denominator
                        + current.lng
                    )
                    if point.lng < crossing_lng:
                        inside = not inside
            j = i
        return inside

    @staticmethod
    def _from_row(row: sqlite3.Row) -> EnterpriseAsset:
        return EnterpriseAsset(
            id=row['id'],
            siteId=row['site_id'],
            assetCode=row['asset_code'],
            name=row['name'],
            type=row['type'],
            coordinate=Coordinate(lat=row['lat'], lng=row['lng']),
            criticality=row['criticality'],
            status=row['status'],
            heatLimitC=row['heat_limit_c'],
            coolingDependent=bool(row['cooling_dependent']),
            owner=row['owner'],
            notes=row['notes'],
            createdAt=row['created_at'],
        )

    def list_assets(self, site_id: str) -> list[EnterpriseAsset]:
        self.site_store.get_site(site_id)
        with self._connect() as db:
            rows = db.execute(
                'SELECT * FROM enterprise_assets WHERE site_id = ? ORDER BY created_at DESC',
                (site_id,),
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def get_asset(self, site_id: str, asset_id: str) -> EnterpriseAsset:
        with self._connect() as db:
            row = db.execute(
                'SELECT * FROM enterprise_assets WHERE id = ? AND site_id = ?',
                (asset_id, site_id),
            ).fetchone()
        if row is None:
            raise FileNotFoundError(asset_id)
        return self._from_row(row)

    def create_asset(self, site_id: str, payload: EnterpriseAssetCreate) -> EnterpriseAsset:
        site = self.site_store.get_site(site_id)
        if not self._point_in_polygon(payload.coordinate, site.polygon):
            raise ValueError('Enterprise assets must be placed inside the saved site boundary.')

        asset_id = f'asset-{uuid4().hex[:12]}'
        asset_code = (payload.assetCode or f'AST-{uuid4().hex[:6].upper()}').strip()
        created_at = datetime.now(timezone.utc).isoformat()

        try:
            with self._connect() as db:
                db.execute(
                    '''INSERT INTO enterprise_assets (
                        id,site_id,asset_code,name,type,lat,lng,criticality,status,
                        heat_limit_c,cooling_dependent,owner,notes,created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (
                        asset_id,
                        site_id,
                        asset_code,
                        payload.name.strip(),
                        payload.type,
                        payload.coordinate.lat,
                        payload.coordinate.lng,
                        payload.criticality,
                        payload.status,
                        payload.heatLimitC,
                        int(payload.coolingDependent),
                        payload.owner.strip() if payload.owner else None,
                        payload.notes.strip() if payload.notes else None,
                        created_at,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError('Asset code already exists at this site.') from exc
        return self.get_asset(site_id, asset_id)

    def delete_asset(self, site_id: str, asset_id: str) -> None:
        self.site_store.get_site(site_id)
        with self._connect() as db:
            cursor = db.execute(
                'DELETE FROM enterprise_assets WHERE id = ? AND site_id = ?',
                (asset_id, site_id),
            )
        if cursor.rowcount == 0:
            raise FileNotFoundError(asset_id)
