from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from app.core.config import Settings
from app.schemas import Coordinate, ThermalMapRequest, ThermalMapResponse, ThermalTile
from app.services.thermal_map import ThermalMapService
from app.services.urban_interventions import UrbanInterventionService
from app.urban_models import UrbanBeforeAfterRequest, UrbanBeforeAfterVerification


_SCREENING_BAND_C = 0.5


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _local_clock_difference_minutes(first: datetime, second: datetime) -> int:
    first_minutes = first.hour * 60 + first.minute
    second_minutes = second.hour * 60 + second.minute
    direct = abs(first_minutes - second_minutes)
    return int(min(direct, 1440 - direct))


def _point_on_segment(point: Coordinate, a: Coordinate, b: Coordinate, epsilon: float = 1e-9) -> bool:
    cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng)
    if abs(cross) > epsilon:
        return False
    return (
        min(a.lng, b.lng) - epsilon <= point.lng <= max(a.lng, b.lng) + epsilon
        and min(a.lat, b.lat) - epsilon <= point.lat <= max(a.lat, b.lat) + epsilon
    )


def _point_in_polygon(point: Coordinate, polygon: list[Coordinate]) -> bool:
    if len(polygon) < 3:
        return False
    for index, current in enumerate(polygon):
        previous = polygon[index - 1]
        if _point_on_segment(point, previous, current):
            return True

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


def _target_tile(point: Coordinate, thermal: ThermalMapResponse) -> ThermalTile | None:
    for tile in thermal.tiles:
        if _point_in_polygon(point, tile.polygon):
            return tile
    return None


class UrbanBeforeAfterService:
    """Verify completed urban interventions against their locked FortyGuard baseline.

    The comparison deliberately separates the raw target-temperature change from
    a district-normalized anomaly change. A positive/negative raw delta alone is
    not treated as intervention impact because background weather can differ
    between dates. HeatShield only promotes a directional relative signal when
    the post-completion observation is spatially matched and local clock time is
    within the configured tolerance.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.path = settings.resolved_database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.interventions = UrbanInterventionService(settings)
        self.thermal = ThermalMapService(settings)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS urban_before_after_verifications (
                    id TEXT PRIMARY KEY,
                    site_id TEXT NOT NULL,
                    intervention_id TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
                    FOREIGN KEY(intervention_id) REFERENCES urban_interventions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_urban_before_after_intervention
                    ON urban_before_after_verifications(site_id, intervention_id, created_at DESC);
            ''')

    def _persist(self, result: UrbanBeforeAfterVerification) -> UrbanBeforeAfterVerification:
        verification_id = result.id or f'verification-{uuid4().hex[:12]}'
        stored = result.model_copy(update={'id': verification_id})
        with self._connect() as db:
            db.execute(
                '''INSERT INTO urban_before_after_verifications
                   (id, site_id, intervention_id, result_json, created_at)
                   VALUES (?, ?, ?, ?, ?)''',
                (
                    verification_id,
                    stored.siteId,
                    stored.interventionId,
                    json.dumps(stored.model_dump(mode='json')),
                    stored.generatedAt,
                ),
            )
        return stored

    def list(self, site_id: str, intervention_id: str) -> list[UrbanBeforeAfterVerification]:
        self.interventions.get(site_id, intervention_id)
        with self._connect() as db:
            rows = db.execute(
                '''SELECT result_json FROM urban_before_after_verifications
                   WHERE site_id = ? AND intervention_id = ?
                   ORDER BY created_at DESC''',
                (site_id, intervention_id),
            ).fetchall()
        output: list[UrbanBeforeAfterVerification] = []
        for row in rows:
            try:
                output.append(UrbanBeforeAfterVerification.model_validate(json.loads(row['result_json'])))
            except (ValueError, TypeError, json.JSONDecodeError):
                continue
        return output

    async def verify(
        self,
        site_id: str,
        intervention_id: str,
        request: UrbanBeforeAfterRequest,
    ) -> UrbanBeforeAfterVerification:
        intervention = self.interventions.get(site_id, intervention_id)
        baseline = intervention.evidence
        generated_at = datetime.now(timezone.utc).isoformat()

        base_fields = dict(
            siteId=site_id,
            interventionId=intervention_id,
            generatedAt=generated_at,
            baselineObservedAt=baseline.baselineObservedAt,
            baselineTemperatureC=baseline.baselineTemperatureC,
            baselineDistrictMeanC=baseline.districtMeanTemperatureC,
            baselineAnomalyC=baseline.anomalyC,
            localTimeToleranceMinutes=request.localTimeToleranceMinutes,
            completionTimestamp=intervention.completedAt,
        )

        if intervention.status not in {'completed', 'archived'} or not intervention.completedAt:
            return UrbanBeforeAfterVerification(
                **base_fields,
                dataStatus='not_ready',
                message='Complete the intervention before running a Before / After verification. The locked baseline remains available.',
            )

        thermal = await self.thermal.generate(
            site_id,
            ThermalMapRequest(mode='site', granularityMeters=request.granularityMeters),
        )

        if thermal.dataStatus == 'configuration_required':
            return UrbanBeforeAfterVerification(
                **base_fields,
                dataStatus='configuration_required',
                afterThermal=thermal,
                message='FortyGuard is not configured, so a post-intervention spatial observation cannot be verified.',
            )

        if thermal.dataStatus != 'verified' or not thermal.observedAt or thermal.meanTemperatureC is None:
            return UrbanBeforeAfterVerification(
                **base_fields,
                dataStatus='unavailable',
                afterThermal=thermal,
                message=thermal.message or 'No verified FortyGuard post-intervention thermal layer is available yet.',
            )

        point = Coordinate(lat=baseline.latitude, lng=baseline.longitude)
        tile = _target_tile(point, thermal)
        after_observed = _parse_datetime(thermal.observedAt)
        completed_at = _parse_datetime(intervention.completedAt)
        baseline_observed = _parse_datetime(baseline.baselineObservedAt)
        post_completion = bool(
            after_observed
            and completed_at
            and after_observed.astimezone(timezone.utc) > completed_at.astimezone(timezone.utc)
        )

        if tile is None:
            return UrbanBeforeAfterVerification(
                **base_fields,
                dataStatus='unavailable',
                afterObservedAt=thermal.observedAt,
                afterDistrictMeanC=thermal.meanTemperatureC,
                afterObservationAfterCompletion=post_completion,
                afterThermal=thermal,
                message='FortyGuard returned a district layer, but no post-intervention cell contains the locked intervention coordinate.',
            )

        after_temperature = tile.temperatureC
        after_anomaly = after_temperature - thermal.meanTemperatureC
        raw_change = after_temperature - baseline.baselineTemperatureC
        anomaly_change = after_anomaly - baseline.anomalyC

        clock_difference = None
        time_matched = False
        if baseline_observed and after_observed:
            clock_difference = _local_clock_difference_minutes(baseline_observed, after_observed)
            time_matched = clock_difference <= request.localTimeToleranceMinutes

        common_fields = dict(
            **base_fields,
            afterObservedAt=thermal.observedAt,
            afterTemperatureC=after_temperature,
            afterDistrictMeanC=thermal.meanTemperatureC,
            afterAnomalyC=after_anomaly,
            rawTemperatureChangeC=raw_change,
            anomalyChangeC=anomaly_change,
            localClockDifferenceMinutes=clock_difference,
            timeMatched=time_matched,
            afterObservationAfterCompletion=post_completion,
            targetCellMatched=True,
            afterThermal=thermal,
        )

        if not post_completion:
            return UrbanBeforeAfterVerification(
                **common_fields,
                dataStatus='not_ready',
                message='The newest verified FortyGuard layer predates the intervention completion time. Wait for a verified post-completion observation before evaluating outcome.',
            )

        if not time_matched:
            result = UrbanBeforeAfterVerification(
                **common_fields,
                dataStatus='context_only',
                evidenceStrength='limited',
                message=(
                    'A verified post-completion target cell is available, but its local observation time is not close enough to the locked baseline. '
                    'Raw and district-normalized values are shown as context; HeatShield blocks a directional intervention conclusion.'
                ),
            )
            return self._persist(result)

        if anomaly_change <= -_SCREENING_BAND_C:
            interpretation = 'relative_cooling_signal'
            message = (
                'The target became cooler relative to the district background under a time-matched post-completion observation. '
                'This is a measured relative cooling signal, not proof that the intervention alone caused the change.'
            )
        elif anomaly_change >= _SCREENING_BAND_C:
            interpretation = 'relative_warming_signal'
            message = (
                'The target became warmer relative to the district background under a time-matched post-completion observation. '
                'This does not establish failure or causation; review contextual conditions and repeat measurements.'
            )
        else:
            interpretation = 'no_clear_change'
            message = (
                f'The district-normalized anomaly changed by less than {_SCREENING_BAND_C:.1f}°C, so HeatShield does not classify a clear directional signal. '
                'Repeat measurements under comparable conditions before making an outcome claim.'
            )

        result = UrbanBeforeAfterVerification(
            **common_fields,
            dataStatus='verified',
            interpretation=interpretation,
            evidenceStrength='strong',
            message=message,
        )
        return self._persist(result)
