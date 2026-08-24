from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.agriculture_schemas import AgricultureField, AgricultureFieldCreate
from app.core.config import Settings
from app.schemas import Coordinate
from app.services.store import HeatShieldStore


class AgricultureFieldStore:
    def __init__(self, settings: Settings):
        self.settings = settings
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
                CREATE TABLE IF NOT EXISTS agriculture_fields (
                    id TEXT PRIMARY KEY,
                    site_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    crop TEXT,
                    growth_stage TEXT,
                    center_lat REAL NOT NULL,
                    center_lng REAL NOT NULL,
                    polygon_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_agriculture_fields_site_id
                    ON agriculture_fields(site_id);
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
                        (previous.lng - current.lng) * (point.lat - current.lat) / denominator + current.lng
                    )
                    if point.lng < crossing_lng:
                        inside = not inside
            j = i
        return inside

    @classmethod
    def _validate_inside_farm(cls, farm_polygon: list[Coordinate], field_polygon: list[Coordinate]) -> None:
        for point in field_polygon:
            if not cls._point_in_polygon(point, farm_polygon):
                raise ValueError('Every field boundary point must stay inside the selected farm boundary.')
        for index, point in enumerate(field_polygon):
            previous = field_polygon[index - 1]
            midpoint = Coordinate(
                lat=(point.lat + previous.lat) / 2,
                lng=(point.lng + previous.lng) / 2,
            )
            if not cls._point_in_polygon(midpoint, farm_polygon):
                raise ValueError('Field boundary edges must stay inside the selected farm boundary.')

    @staticmethod
    def _center(points: list[Coordinate]) -> Coordinate:
        return Coordinate(
            lat=sum(point.lat for point in points) / len(points),
            lng=sum(point.lng for point in points) / len(points),
        )

    @staticmethod
    def _from_row(row: sqlite3.Row) -> AgricultureField:
        return AgricultureField(
            id=row['id'],
            siteId=row['site_id'],
            name=row['name'],
            crop=row['crop'],
            growthStage=row['growth_stage'],
            center=Coordinate(lat=row['center_lat'], lng=row['center_lng']),
            polygon=[Coordinate.model_validate(item) for item in json.loads(row['polygon_json'])],
            status=row['status'],
        )

    def list_fields(self, site_id: str) -> list[AgricultureField]:
        self.site_store.get_site(site_id)
        with self._connect() as db:
            rows = db.execute(
                'SELECT * FROM agriculture_fields WHERE site_id = ? ORDER BY created_at DESC',
                (site_id,),
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def get_field(self, site_id: str, field_id: str) -> AgricultureField:
        with self._connect() as db:
            row = db.execute(
                'SELECT * FROM agriculture_fields WHERE site_id = ? AND id = ?',
                (site_id, field_id),
            ).fetchone()
        if row is None:
            raise FileNotFoundError(field_id)
        return self._from_row(row)

    def create_field(self, site_id: str, payload: AgricultureFieldCreate) -> AgricultureField:
        site = self.site_store.get_site(site_id)
        points = list(payload.polygon)
        self._validate_inside_farm(site.polygon, points)
        center = self._center(points)
        field_id = f'field-{uuid4().hex[:12]}'
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute(
                '''INSERT INTO agriculture_fields (
                    id,site_id,name,crop,growth_stage,center_lat,center_lng,polygon_json,status,created_at
                ) VALUES (?,?,?,?,?,?,?,?,'active',?)''',
                (
                    field_id,
                    site_id,
                    payload.name.strip(),
                    payload.crop.strip() if payload.crop else None,
                    payload.growthStage.strip() if payload.growthStage else None,
                    center.lat,
                    center.lng,
                    json.dumps([point.model_dump() for point in points]),
                    now,
                ),
            )
        return self.get_field(site_id, field_id)

    def delete_field(self, site_id: str, field_id: str) -> None:
        self.site_store.get_site(site_id)
        with self._connect() as db:
            cursor = db.execute(
                'DELETE FROM agriculture_fields WHERE site_id = ? AND id = ?',
                (site_id, field_id),
            )
        if cursor.rowcount == 0:
            raise FileNotFoundError(field_id)
