from __future__ import annotations

import sqlite3

from app.core.config import Settings
from app.schemas import OperationalApproval
from app.services.store import HeatShieldStore


class WorkforceReportStore:
    """Read persisted supervisor decisions for evidence-backed workforce reports."""

    def __init__(self, settings: Settings):
        self.path = settings.resolved_database_path
        self.site_store = HeatShieldStore(settings)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        return db

    @staticmethod
    def _approval_from_row(row: sqlite3.Row) -> OperationalApproval:
        return OperationalApproval(
            id=row['id'],
            siteId=row['site_id'],
            workerId=row['worker_id'],
            choice=row['choice'],
            targetTime=row['target_time'],
            targetZoneId=row['target_zone_id'],
            baselineTemperatureC=row['baseline_temperature_c'],
            expectedTemperatureC=row['expected_temperature_c'],
            expectedReductionC=row['expected_reduction_c'],
            status=row['status'],
            createdAt=row['created_at'],
            verifiedAt=row['verified_at'],
            verifiedTemperatureC=row['verified_temperature_c'],
            actualReductionC=row['actual_reduction_c'],
            verificationMessage=row['verification_message'],
        )

    def list_operational_approvals(self, site_id: str) -> list[OperationalApproval]:
        self.site_store.get_site(site_id)
        with self._connect() as db:
            rows = db.execute(
                'SELECT * FROM operational_approvals WHERE site_id = ? ORDER BY created_at DESC',
                (site_id,),
            ).fetchall()
        return [self._approval_from_row(row) for row in rows]
