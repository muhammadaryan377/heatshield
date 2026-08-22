from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.core.config import Settings
from app.schemas import Coordinate, Site, SiteCreate, SiteZone, Worker, WorkerCreate


class HeatShieldStore:
    def __init__(self, settings: Settings):
        self.path = settings.resolved_database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        return db

    @staticmethod
    def _ensure_worker_columns(db: sqlite3.Connection) -> None:
        existing = {row['name'] for row in db.execute('PRAGMA table_info(workers)').fetchall()}
        additions = {
            'worker_code': 'TEXT',
            'team': 'TEXT',
            'supervisor': 'TEXT',
            'notes': 'TEXT',
        }
        for column, definition in additions.items():
            if column not in existing:
                db.execute(f'ALTER TABLE workers ADD COLUMN {column} {definition}')

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sites (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    address TEXT NOT NULL,
                    center_lat REAL NOT NULL,
                    center_lng REAL NOT NULL,
                    polygon_json TEXT NOT NULL,
                    zones_json TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workers (
                    id TEXT PRIMARY KEY,
                    site_id TEXT NOT NULL,
                    worker_code TEXT,
                    name TEXT NOT NULL,
                    initials TEXT NOT NULL,
                    role TEXT NOT NULL,
                    team TEXT,
                    location TEXT NOT NULL,
                    location_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    risk TEXT NOT NULL DEFAULT 'low',
                    last_check_in TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    task TEXT,
                    work_intensity TEXT,
                    shift_start TEXT,
                    shift_end TEXT,
                    sun_exposure TEXT,
                    shade_access TEXT,
                    water_access INTEGER,
                    supervisor TEXT,
                    notes TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_workers_site_id ON workers(site_id);
            ''')
            self._ensure_worker_columns(db)

    @staticmethod
    def _site_from_row(row: sqlite3.Row) -> Site:
        return Site(
            id=row['id'], name=row['name'], address=row['address'],
            center=Coordinate(lat=row['center_lat'], lng=row['center_lng']),
            polygon=[Coordinate.model_validate(item) for item in json.loads(row['polygon_json'])],
            zones=[SiteZone.model_validate(item) for item in json.loads(row['zones_json'])],
            status=row['status'],
        )

    @staticmethod
    def _worker_from_row(row: sqlite3.Row) -> Worker:
        return Worker(
            id=row['id'], siteId=row['site_id'], workerCode=row['worker_code'],
            name=row['name'], initials=row['initials'], role=row['role'], team=row['team'],
            location=row['location'], locationId=row['location_id'], status=row['status'],
            risk=row['risk'], lastCheckIn=row['last_check_in'],
            coordinate=Coordinate(lat=row['lat'], lng=row['lng']), task=row['task'],
            workIntensity=row['work_intensity'], shiftStart=row['shift_start'], shiftEnd=row['shift_end'],
            sunExposure=row['sun_exposure'], shadeAccess=row['shade_access'],
            waterAccess=None if row['water_access'] is None else bool(row['water_access']),
            supervisor=row['supervisor'], notes=row['notes'],
        )

    def list_sites(self) -> list[Site]:
        with self._connect() as db:
            rows = db.execute('SELECT * FROM sites ORDER BY created_at DESC').fetchall()
        return [self._site_from_row(row) for row in rows]

    def get_site(self, site_id: str) -> Site:
        with self._connect() as db:
            row = db.execute('SELECT * FROM sites WHERE id = ?', (site_id,)).fetchone()
        if row is None:
            raise FileNotFoundError(site_id)
        return self._site_from_row(row)

    def create_site(self, payload: SiteCreate) -> Site:
        site_id = f'site-{uuid4().hex[:12]}'
        with self._connect() as db:
            db.execute(
                'INSERT INTO sites (id,name,address,center_lat,center_lng,polygon_json,zones_json,status,created_at) VALUES (?,?,?,?,?,?,?,\'active\',?)',
                (site_id, payload.name.strip(), payload.address.strip(), payload.center.lat, payload.center.lng,
                 json.dumps([point.model_dump() for point in payload.polygon]),
                 json.dumps([zone.model_dump() for zone in payload.zones]), datetime.now(timezone.utc).isoformat()),
            )
        return self.get_site(site_id)

    def list_workers(self, site_id: str) -> list[Worker]:
        self.get_site(site_id)
        with self._connect() as db:
            rows = db.execute('SELECT * FROM workers WHERE site_id = ? ORDER BY created_at DESC', (site_id,)).fetchall()
        return [self._worker_from_row(row) for row in rows]

    def create_worker(self, site_id: str, payload: WorkerCreate) -> Worker:
        self.get_site(site_id)
        worker_id = f'worker-{uuid4().hex[:12]}'
        worker_code = (payload.workerCode or f'WKR-{uuid4().hex[:6].upper()}').strip()
        initials = ''.join(part[0].upper() for part in payload.name.split()[:2]) or 'W'
        now = datetime.now(timezone.utc)
        last_check_in = now.strftime('%H:%M')

        with self._connect() as db:
            duplicate = db.execute(
                'SELECT 1 FROM workers WHERE site_id = ? AND worker_code = ? LIMIT 1',
                (site_id, worker_code),
            ).fetchone()
            if duplicate is not None:
                raise ValueError('Worker ID already exists at this site.')

            db.execute(
                '''INSERT INTO workers (
                    id,site_id,worker_code,name,initials,role,team,location,location_id,status,risk,
                    last_check_in,lat,lng,task,work_intensity,shift_start,shift_end,sun_exposure,
                    shade_access,water_access,supervisor,notes,created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,'low',?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (
                    worker_id, site_id, worker_code, payload.name.strip(), initials, payload.role.strip(),
                    payload.team.strip() if payload.team else None,
                    payload.location.strip(), payload.locationId.strip(), payload.status,
                    last_check_in, payload.coordinate.lat, payload.coordinate.lng, payload.task,
                    payload.workIntensity, payload.shiftStart, payload.shiftEnd, payload.sunExposure,
                    payload.shadeAccess, None if payload.waterAccess is None else int(payload.waterAccess),
                    payload.supervisor.strip() if payload.supervisor else None,
                    payload.notes.strip() if payload.notes else None,
                    now.isoformat(),
                ),
            )
            row = db.execute('SELECT * FROM workers WHERE id = ?', (worker_id,)).fetchone()
        assert row is not None
        return self._worker_from_row(row)
