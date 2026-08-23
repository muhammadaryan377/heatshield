from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.core.config import Settings
from app.schemas import (
    Coordinate,
    OperationalApproval,
    OperationalApprovalRequest,
    Site,
    SiteCreate,
    SiteProfile,
    SiteUpdate,
    SiteZone,
    SiteZoneCreate,
    SiteZoneUpdate,
    Worker,
    WorkerCreate,
)


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

    @staticmethod
    def _ensure_site_columns(db: sqlite3.Connection) -> None:
        existing = {row['name'] for row in db.execute('PRAGMA table_info(sites)').fetchall()}
        if 'profile_json' not in existing:
            db.execute("ALTER TABLE sites ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}'")

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
                    profile_json TEXT NOT NULL DEFAULT '{}',
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
                CREATE TABLE IF NOT EXISTS operational_approvals (
                    id TEXT PRIMARY KEY,
                    site_id TEXT NOT NULL,
                    worker_id TEXT NOT NULL,
                    choice TEXT NOT NULL,
                    target_time TEXT,
                    target_zone_id TEXT,
                    baseline_temperature_c REAL,
                    expected_temperature_c REAL,
                    expected_reduction_c REAL,
                    status TEXT NOT NULL DEFAULT 'pending_verification',
                    created_at TEXT NOT NULL,
                    verified_at TEXT,
                    verified_temperature_c REAL,
                    actual_reduction_c REAL,
                    verification_message TEXT,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
                    FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_workers_site_id ON workers(site_id);
                CREATE INDEX IF NOT EXISTS idx_operational_approvals_site_id ON operational_approvals(site_id);
            ''')
            self._ensure_worker_columns(db)
            self._ensure_site_columns(db)

    @staticmethod
    def _site_from_row(row: sqlite3.Row) -> Site:
        profile_raw = row['profile_json'] if 'profile_json' in row.keys() else '{}'
        try:
            profile = SiteProfile.model_validate(json.loads(profile_raw or '{}'))
        except (ValueError, TypeError, json.JSONDecodeError):
            profile = SiteProfile()
        return Site(
            id=row['id'], name=row['name'], address=row['address'],
            center=Coordinate(lat=row['center_lat'], lng=row['center_lng']),
            polygon=[Coordinate.model_validate(item) for item in json.loads(row['polygon_json'])],
            zones=[SiteZone.model_validate(item) for item in json.loads(row['zones_json'])],
            status=row['status'], profile=profile,
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

    @staticmethod
    def _approval_from_row(row: sqlite3.Row) -> OperationalApproval:
        return OperationalApproval(
            id=row['id'], siteId=row['site_id'], workerId=row['worker_id'], choice=row['choice'],
            targetTime=row['target_time'], targetZoneId=row['target_zone_id'],
            baselineTemperatureC=row['baseline_temperature_c'], expectedTemperatureC=row['expected_temperature_c'],
            expectedReductionC=row['expected_reduction_c'], status=row['status'], createdAt=row['created_at'],
            verifiedAt=row['verified_at'], verifiedTemperatureC=row['verified_temperature_c'],
            actualReductionC=row['actual_reduction_c'], verificationMessage=row['verification_message'],
        )

    @staticmethod
    def _point_in_polygon(point: Coordinate, polygon: list[Coordinate]) -> bool:
        if len(polygon) < 3:
            return False
        inside = False
        j = len(polygon) - 1
        for i, current in enumerate(polygon):
            previous = polygon[j]
            if ((current.lat > point.lat) != (previous.lat > point.lat)):
                denominator = previous.lat - current.lat
                if abs(denominator) > 1e-12:
                    crossing_lng = (previous.lng - current.lng) * (point.lat - current.lat) / denominator + current.lng
                    if point.lng < crossing_lng:
                        inside = not inside
            j = i
        return inside

    @classmethod
    def _polygon_inside(cls, child: list[Coordinate], parent: list[Coordinate]) -> bool:
        return len(child) >= 3 and all(cls._point_in_polygon(point, parent) for point in child)

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
                '''INSERT INTO sites (
                    id,name,address,center_lat,center_lng,polygon_json,zones_json,profile_json,status,created_at
                ) VALUES (?,?,?,?,?,?,?,?,\'active\',?)''',
                (
                    site_id, payload.name.strip(), payload.address.strip(), payload.center.lat, payload.center.lng,
                    json.dumps([point.model_dump() for point in payload.polygon]),
                    json.dumps([zone.model_dump() for zone in payload.zones]),
                    json.dumps(payload.profile.model_dump()), datetime.now(timezone.utc).isoformat(),
                ),
            )
        return self.get_site(site_id)

    def update_site(self, site_id: str, payload: SiteUpdate) -> Site:
        site = self.get_site(site_id)
        workers = self.list_workers(site_id)
        outside_workers = [worker.name for worker in workers if not self._point_in_polygon(worker.coordinate, payload.polygon)]
        if outside_workers:
            names = ', '.join(outside_workers[:3])
            raise ValueError(f'New site boundary would leave assigned worker(s) outside: {names}. Move them first or redraw the boundary.')
        outside_zones = [zone.name for zone in site.zones if zone.polygon and not self._polygon_inside(zone.polygon, payload.polygon)]
        if outside_zones:
            names = ', '.join(outside_zones[:3])
            raise ValueError(f'New site boundary would leave operational zone(s) outside: {names}. Update or remove those zones first.')
        with self._connect() as db:
            db.execute(
                '''UPDATE sites SET name=?, address=?, center_lat=?, center_lng=?, polygon_json=?, status=?, profile_json=?
                   WHERE id=?''',
                (
                    payload.name.strip(), payload.address.strip(), payload.center.lat, payload.center.lng,
                    json.dumps([point.model_dump() for point in payload.polygon]), payload.status,
                    json.dumps(payload.profile.model_dump()), site_id,
                ),
            )
        return self.get_site(site_id)

    def delete_site(self, site_id: str) -> None:
        self.get_site(site_id)
        with self._connect() as db:
            db.execute('DELETE FROM sites WHERE id = ?', (site_id,))

    def _validated_zone(self, site: Site, payload: SiteZoneCreate | SiteZoneUpdate, zone_id: str) -> SiteZone:
        if not self._point_in_polygon(payload.center, site.polygon) or not self._polygon_inside(payload.polygon, site.polygon):
            raise ValueError('The complete operational-zone polygon must stay inside the saved site boundary.')
        return SiteZone(
            id=zone_id, name=payload.name.strip(), type=payload.type, center=payload.center,
            polygon=payload.polygon, allowedTasks=payload.allowedTasks, operationalApproved=payload.operationalApproved,
        )

    def add_zone(self, site_id: str, payload: SiteZoneCreate) -> Site:
        site = self.get_site(site_id)
        zone = self._validated_zone(site, payload, f'zone-{uuid4().hex[:10]}')
        zones = [*site.zones, zone]
        with self._connect() as db:
            db.execute('UPDATE sites SET zones_json = ? WHERE id = ?', (json.dumps([item.model_dump() for item in zones]), site_id))
        return self.get_site(site_id)

    def update_zone(self, site_id: str, zone_id: str, payload: SiteZoneUpdate) -> Site:
        site = self.get_site(site_id)
        if not any(zone.id == zone_id for zone in site.zones):
            raise FileNotFoundError(zone_id)
        replacement = self._validated_zone(site, payload, zone_id)
        zones = [replacement if zone.id == zone_id else zone for zone in site.zones]
        with self._connect() as db:
            db.execute('UPDATE sites SET zones_json = ? WHERE id = ?', (json.dumps([item.model_dump() for item in zones]), site_id))
        return self.get_site(site_id)

    def delete_zone(self, site_id: str, zone_id: str) -> Site:
        site = self.get_site(site_id)
        zones = [zone for zone in site.zones if zone.id != zone_id]
        if len(zones) == len(site.zones):
            raise FileNotFoundError(zone_id)
        with self._connect() as db:
            db.execute('UPDATE sites SET zones_json = ? WHERE id = ?', (json.dumps([item.model_dump() for item in zones]), site_id))
        return self.get_site(site_id)

    def list_workers(self, site_id: str) -> list[Worker]:
        self.get_site(site_id)
        with self._connect() as db:
            rows = db.execute('SELECT * FROM workers WHERE site_id = ? ORDER BY created_at DESC', (site_id,)).fetchall()
        return [self._worker_from_row(row) for row in rows]

    def get_worker(self, site_id: str, worker_id: str) -> Worker:
        with self._connect() as db:
            row = db.execute('SELECT * FROM workers WHERE id = ? AND site_id = ?', (worker_id, site_id)).fetchone()
        if row is None:
            raise FileNotFoundError(worker_id)
        return self._worker_from_row(row)

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

    def create_operational_approval(self, site_id: str, payload: OperationalApprovalRequest) -> OperationalApproval:
        self.get_site(site_id)
        self.get_worker(site_id, payload.workerId)
        site = self.get_site(site_id)
        if payload.choice == 'better_place':
            if not payload.targetZoneId or not any(zone.id == payload.targetZoneId and zone.operationalApproved for zone in site.zones):
                raise ValueError('Better-place approvals require an approved site zone.')
        approval_id = f'approval-{uuid4().hex[:12]}'
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute(
                '''INSERT INTO operational_approvals (
                    id,site_id,worker_id,choice,target_time,target_zone_id,baseline_temperature_c,
                    expected_temperature_c,expected_reduction_c,status,created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,'pending_verification',?)''',
                (
                    approval_id, site_id, payload.workerId, payload.choice, payload.targetTime, payload.targetZoneId,
                    payload.baselineTemperatureC, payload.expectedTemperatureC, payload.expectedReductionC, created_at,
                ),
            )
            row = db.execute('SELECT * FROM operational_approvals WHERE id = ?', (approval_id,)).fetchone()
        assert row is not None
        return self._approval_from_row(row)

    def get_operational_approval(self, site_id: str, approval_id: str) -> OperationalApproval:
        with self._connect() as db:
            row = db.execute('SELECT * FROM operational_approvals WHERE id = ? AND site_id = ?', (approval_id, site_id)).fetchone()
        if row is None:
            raise FileNotFoundError(approval_id)
        return self._approval_from_row(row)

    def update_operational_verification(
        self,
        site_id: str,
        approval_id: str,
        *,
        status: str,
        verified_temperature_c: float | None,
        actual_reduction_c: float | None,
        message: str,
    ) -> OperationalApproval:
        self.get_operational_approval(site_id, approval_id)
        verified_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute(
                '''UPDATE operational_approvals
                   SET status=?, verified_at=?, verified_temperature_c=?, actual_reduction_c=?, verification_message=?
                   WHERE id=? AND site_id=?''',
                (status, verified_at, verified_temperature_c, actual_reduction_c, message, approval_id, site_id),
            )
        return self.get_operational_approval(site_id, approval_id)
