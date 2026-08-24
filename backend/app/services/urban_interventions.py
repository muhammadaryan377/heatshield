from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.core.config import Settings
from app.schemas import Coordinate
from app.services.store import HeatShieldStore
from app.urban_models import (
    UrbanIntervention,
    UrbanInterventionCreate,
    UrbanInterventionEvidence,
    UrbanInterventionUpdate,
)


_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    'proposed': {'approved', 'archived'},
    'approved': {'proposed', 'in_progress', 'archived'},
    'in_progress': {'approved', 'completed', 'archived'},
    'completed': {'archived'},
    'archived': set(),
}


class UrbanInterventionService:
    """Persist intervention decisions while preserving the exact evidence baseline.

    FortyGuard provides the measured heat evidence; HeatShield stores the planning
    decision separately. The service intentionally does not predict a cooling
    delta because the provider evidence does not establish an intervention effect.
    Screen 6 can later compare a completed intervention against this locked
    baseline using new, time-matched FortyGuard observations.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = settings.resolved_database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.store = HeatShieldStore(settings)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS urban_interventions (
                    id TEXT PRIMARY KEY,
                    site_id TEXT NOT NULL,
                    intervention_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'proposed',
                    owner TEXT,
                    target_date TEXT,
                    target_area_m2 REAL,
                    rationale TEXT NOT NULL,
                    mechanism TEXT NOT NULL,
                    measurement_plan TEXT NOT NULL,
                    evidence_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_urban_interventions_site_id
                    ON urban_interventions(site_id);
                CREATE INDEX IF NOT EXISTS idx_urban_interventions_status
                    ON urban_interventions(status);
            ''')

    @staticmethod
    def _point_in_polygon(point: Coordinate, polygon: list[Coordinate]) -> bool:
        if len(polygon) < 3:
            return False
        inside = False
        j = len(polygon) - 1
        for i, current in enumerate(polygon):
            previous = polygon[j]
            denominator = previous.lat - current.lat
            if ((current.lat > point.lat) != (previous.lat > point.lat)) and abs(denominator) > 1e-12:
                crossing_lng = (
                    (previous.lng - current.lng) * (point.lat - current.lat) / denominator + current.lng
                )
                if point.lng < crossing_lng:
                    inside = not inside
            j = i
        return inside

    @staticmethod
    def _from_row(row: sqlite3.Row) -> UrbanIntervention:
        return UrbanIntervention(
            id=row['id'],
            siteId=row['site_id'],
            type=row['intervention_type'],
            title=row['title'],
            status=row['status'],
            owner=row['owner'],
            targetDate=row['target_date'],
            targetAreaM2=row['target_area_m2'],
            rationale=row['rationale'],
            mechanism=row['mechanism'],
            measurementPlan=row['measurement_plan'],
            evidence=UrbanInterventionEvidence.model_validate(json.loads(row['evidence_json'])),
            createdAt=row['created_at'],
            updatedAt=row['updated_at'],
            completedAt=row['completed_at'],
        )

    def list(self, site_id: str) -> list[UrbanIntervention]:
        self.store.get_site(site_id)
        with self._connect() as db:
            rows = db.execute(
                '''SELECT * FROM urban_interventions
                   WHERE site_id = ?
                   ORDER BY CASE status
                       WHEN 'in_progress' THEN 0
                       WHEN 'approved' THEN 1
                       WHEN 'proposed' THEN 2
                       WHEN 'completed' THEN 3
                       ELSE 4 END,
                       created_at DESC''',
                (site_id,),
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def get(self, site_id: str, intervention_id: str) -> UrbanIntervention:
        self.store.get_site(site_id)
        with self._connect() as db:
            row = db.execute(
                'SELECT * FROM urban_interventions WHERE id = ? AND site_id = ?',
                (intervention_id, site_id),
            ).fetchone()
        if row is None:
            raise FileNotFoundError(intervention_id)
        return self._from_row(row)

    def create(self, site_id: str, payload: UrbanInterventionCreate) -> UrbanIntervention:
        site = self.store.get_site(site_id)
        evidence_point = Coordinate(latitude=payload.evidence.latitude, longitude=payload.evidence.longitude)
        # Coordinate uses lat/lng aliases through CamelModel; construct explicitly for clarity.
        evidence_point = Coordinate(lat=payload.evidence.latitude, lng=payload.evidence.longitude)
        if not self._point_in_polygon(evidence_point, site.polygon):
            raise ValueError('The intervention target must be inside the selected district boundary.')

        intervention_id = f'intervention-{uuid4().hex[:12]}'
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute(
                '''INSERT INTO urban_interventions (
                    id, site_id, intervention_type, title, status, owner, target_date,
                    target_area_m2, rationale, mechanism, measurement_plan, evidence_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    intervention_id,
                    site_id,
                    payload.type,
                    payload.title.strip(),
                    payload.owner.strip() if payload.owner else None,
                    payload.targetDate,
                    payload.targetAreaM2,
                    payload.rationale.strip(),
                    payload.mechanism.strip(),
                    payload.measurementPlan.strip(),
                    json.dumps(payload.evidence.model_dump()),
                    now,
                    now,
                ),
            )
        return self.get(site_id, intervention_id)

    def update(self, site_id: str, intervention_id: str, payload: UrbanInterventionUpdate) -> UrbanIntervention:
        current = self.get(site_id, intervention_id)
        if payload.status == current.status:
            return current
        allowed = _ALLOWED_TRANSITIONS.get(current.status, set())
        if payload.status not in allowed:
            raise ValueError(f'Cannot move intervention from {current.status} to {payload.status}.')

        now = datetime.now(timezone.utc).isoformat()
        completed_at = now if payload.status == 'completed' else current.completedAt
        with self._connect() as db:
            db.execute(
                '''UPDATE urban_interventions
                   SET status = ?, updated_at = ?, completed_at = ?
                   WHERE id = ? AND site_id = ?''',
                (payload.status, now, completed_at, intervention_id, site_id),
            )
        return self.get(site_id, intervention_id)
