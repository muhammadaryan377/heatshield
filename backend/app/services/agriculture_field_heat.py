from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from hashlib import sha1
from typing import Any
from zoneinfo import ZoneInfo

from app.agriculture_schemas import (
    AgricultureFieldHeatCell,
    AgricultureFieldHeatLayer,
    AgricultureFieldHeatProfile,
    AgricultureFieldHeatRequest,
)
from app.core.config import Settings
from app.schemas import Coordinate
from app.services.agriculture_fields import AgricultureFieldStore
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.fortyguard_profile import _analysis_value, _hourly_peak_hour, _local_hour_label, _tcm_temperature
from app.services.store import HeatShieldStore


_FIELD_PROFILE_CACHE: dict[str, tuple[datetime, AgricultureFieldHeatProfile]] = {}
_ANALYTIC_TYPES = ('tcm', 'time_of_measure', 'exceedance', 'persistence')
_LATEST_DAY_FALLBACKS = 2


def _geojson_polygon(points: list[Coordinate]) -> dict[str, Any]:
    ring = [[point.lng, point.lat] for point in points]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return {
        'type': 'FeatureCollection',
        'features': [
            {
                'type': 'Feature',
                'properties': {},
                'geometry': {'type': 'Polygon', 'coordinates': [ring]},
            }
        ],
    }


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _coordinate_ring(raw: Any) -> list[Coordinate] | None:
    if not isinstance(raw, list) or len(raw) < 4:
        return None
    points: list[Coordinate] = []
    for position in raw:
        if not isinstance(position, list) or len(position) < 2:
            return None
        lng, lat = position[0], position[1]
        if not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
            return None
        points.append(Coordinate(lat=float(lat), lng=float(lng)))
    return points


def _feature_cells(features: list[Any], analytic_type: str) -> list[AgricultureFieldHeatCell]:
    cells: list[AgricultureFieldHeatCell] = []
    for feature_index, feature in enumerate(features):
        if not isinstance(feature, dict):
            continue
        properties = feature.get('properties') if isinstance(feature.get('properties'), dict) else {}
        geometry = feature.get('geometry') if isinstance(feature.get('geometry'), dict) else {}
        value = _tcm_temperature(feature) if analytic_type == 'tcm' else _analysis_value(feature)
        if value is None:
            continue

        raw_coordinates = geometry.get('coordinates')
        rings: list[list[Coordinate]] = []
        if geometry.get('type') == 'Polygon' and isinstance(raw_coordinates, list) and raw_coordinates:
            ring = _coordinate_ring(raw_coordinates[0])
            if ring:
                rings.append(ring)
        elif geometry.get('type') == 'MultiPolygon' and isinstance(raw_coordinates, list):
            for polygon in raw_coordinates:
                if isinstance(polygon, list) and polygon:
                    ring = _coordinate_ring(polygon[0])
                    if ring:
                        rings.append(ring)

        tile_id = properties.get('tile_id', feature.get('id', feature_index + 1))
        for ring_index, ring in enumerate(rings):
            cells.append(AgricultureFieldHeatCell(
                id=f'{analytic_type}-{tile_id}-{ring_index + 1}',
                value=round(float(value), 3),
                polygon=ring,
            ))
    return cells


def _layer_summary(
    analytic_type: str,
    activity_id: str | None,
    result: dict[str, Any] | None,
    error: str | None,
) -> AgricultureFieldHeatLayer:
    if result is None:
        return AgricultureFieldHeatLayer(
            analyticType=analytic_type,
            status='unavailable',
            activityId=activity_id,
            message=error,
        )

    map_data = result.get('map_data') if isinstance(result.get('map_data'), dict) else {}
    features = map_data.get('features') if isinstance(map_data.get('features'), list) else []
    cells = _feature_cells(features, analytic_type)
    stats = result.get('stats_data') if isinstance(result.get('stats_data'), dict) else {}

    if analytic_type == 'tcm':
        temperature_stats = stats.get('temperature_stats') if isinstance(stats.get('temperature_stats'), dict) else {}
        minimum = _number(temperature_stats.get('minimum'))
        maximum = _number(temperature_stats.get('maximum'))
        mean = _number(temperature_stats.get('mean'))
        units = '°C'
    else:
        minimum = _number(stats.get('min'))
        maximum = _number(stats.get('max'))
        mean = _number(stats.get('mean'))
        units = str(stats.get('units')) if stats.get('units') is not None else 'hour'

    if not cells:
        return AgricultureFieldHeatLayer(
            analyticType=analytic_type,
            status='unavailable',
            activityId=activity_id,
            units=units,
            message=error or 'FortyGuard completed this layer but returned no usable spatial cells.',
        )

    values = [cell.value for cell in cells]
    return AgricultureFieldHeatLayer(
        analyticType=analytic_type,
        status='verified',
        activityId=activity_id,
        units=units,
        minValue=minimum if minimum is not None else min(values),
        maxValue=maximum if maximum is not None else max(values),
        meanValue=mean if mean is not None else sum(values) / len(values),
        cells=cells,
    )


def _study_date(site, requested: str | None) -> tuple[str, str]:
    timezone_name, site_timezone = FortyGuardClient._site_timezone(site)
    local_today = datetime.now(timezone.utc).astimezone(site_timezone).date()
    if requested:
        try:
            selected = date.fromisoformat(requested)
        except ValueError as exc:
            raise ValueError('Field heat date must use YYYY-MM-DD.') from exc
    else:
        selected = local_today
    if selected < date(2019, 1, 1):
        raise ValueError('FortyGuard field heat dates must be on or after 2019-01-01.')
    if selected > local_today:
        raise ValueError('Field daily analysis cannot use a future date.')
    return selected.isoformat(), timezone_name


def _cache_key(site_id: str, field_id: str, request: AgricultureFieldHeatRequest, requested_date: str) -> str:
    raw = f'{site_id}|{field_id}|{requested_date}|{request.thresholdC:.3f}|{request.granularityMeters}'
    return sha1(raw.encode('utf-8')).hexdigest()


def _unrequested_layer(analytic_type: str) -> AgricultureFieldHeatLayer:
    return AgricultureFieldHeatLayer(
        analyticType=analytic_type,
        status='unavailable',
        message='Not requested because no verified field temperature layer was available.',
    )


class AgricultureFieldHeatService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.site_store = HeatShieldStore(settings)
        self.field_store = AgricultureFieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    def _cached(self, key: str, now: datetime) -> AgricultureFieldHeatProfile | None:
        cached = _FIELD_PROFILE_CACHE.get(key)
        if not cached:
            return None
        cached_at, profile = cached
        ttl = max(0, self.settings.fortyguard_cache_ttl_seconds)
        if ttl and (now - cached_at).total_seconds() <= ttl:
            return profile.model_copy(update={'cached': True})
        _FIELD_PROFILE_CACHE.pop(key, None)
        return None

    def _cache(self, key: str, now: datetime, profile: AgricultureFieldHeatProfile) -> None:
        if self.settings.fortyguard_cache_ttl_seconds > 0:
            _FIELD_PROFILE_CACHE[key] = (now, profile)

    async def _request_layer(
        self,
        *,
        polygon: list[Coordinate],
        study_date: str,
        granularity: int,
        analytic_type: str,
        threshold_c: float,
    ) -> tuple[str | None, dict[str, Any] | None, str | None]:
        payload: dict[str, Any] = {
            'polygon_aoi': _geojson_polygon(polygon),
            'date_time': {'start_date': study_date, 'filter_type': 3},
            'granularity': granularity,
            'analytic_type': analytic_type,
        }
        if analytic_type in {'exceedance', 'persistence'}:
            payload['threshold'] = threshold_c
            payload['direction'] = 'above'

        activity_id: str | None = None
        try:
            activity_id = await self.fortyguard._submit('/v1/heatmap', payload)
            result = await self.fortyguard._wait(activity_id)
            return activity_id, result, None
        except FortyGuardAPIError as exc:
            return activity_id, None, str(exc)

    async def generate(
        self,
        site_id: str,
        field_id: str,
        request: AgricultureFieldHeatRequest,
    ) -> AgricultureFieldHeatProfile:
        site = self.site_store.get_site(site_id)
        field = self.field_store.get_field(site_id, field_id)
        requested_date_text, timezone_name = _study_date(site, request.date)
        now = datetime.now(timezone.utc)
        key = _cache_key(site_id, field_id, request, requested_date_text)
        cached = self._cached(key, now)
        if cached is not None:
            return cached

        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            return AgricultureFieldHeatProfile(
                siteId=site_id,
                fieldId=field.id,
                fieldName=field.name,
                date=requested_date_text,
                timezoneName=timezone_name,
                thresholdC=request.thresholdC,
                granularityMeters=request.granularityMeters,
                dataStatus='configuration_required',
                generatedAt=now.isoformat(),
                message='FortyGuard API key is not configured. Field heat layers require FortyGuard.',
            )

        requested_date = date.fromisoformat(requested_date_text)
        candidate_dates = [requested_date]
        if request.date is None:
            candidate_dates.extend(requested_date - timedelta(days=offset) for offset in range(1, _LATEST_DAY_FALLBACKS + 1))

        provider_request_count = 0
        tcm_result_tuple: tuple[str | None, dict[str, Any] | None, str | None] | None = None
        tcm_layer: AgricultureFieldHeatLayer | None = None
        effective_date_text = requested_date_text
        tcm_errors: list[str] = []

        for candidate_date in candidate_dates:
            candidate_text = candidate_date.isoformat()
            result_tuple = await self._request_layer(
                polygon=field.polygon,
                study_date=candidate_text,
                granularity=request.granularityMeters,
                analytic_type='tcm',
                threshold_c=request.thresholdC,
            )
            if result_tuple[0]:
                provider_request_count += 1
            candidate_layer = _layer_summary('tcm', *result_tuple)
            if candidate_layer.status == 'verified':
                tcm_result_tuple = result_tuple
                tcm_layer = candidate_layer
                effective_date_text = candidate_text
                break
            if candidate_layer.message:
                tcm_errors.append(f'{candidate_text}: {candidate_layer.message}')

        if tcm_layer is None or tcm_result_tuple is None:
            unavailable_tcm = AgricultureFieldHeatLayer(
                analyticType='tcm',
                status='unavailable',
                message=(
                    f'No usable FortyGuard field temperature cells were returned for {len(candidate_dates)} checked day(s).'
                    if request.date is None
                    else (tcm_errors[-1] if tcm_errors else 'FortyGuard returned no usable field temperature cells.')
                ),
            )
            layers = [
                unavailable_tcm,
                _unrequested_layer('time_of_measure'),
                _unrequested_layer('exceedance'),
                _unrequested_layer('persistence'),
            ]
            profile = AgricultureFieldHeatProfile(
                siteId=site_id,
                fieldId=field.id,
                fieldName=field.name,
                date=requested_date_text,
                timezoneName=timezone_name,
                thresholdC=request.thresholdC,
                granularityMeters=request.granularityMeters,
                dataStatus='unavailable',
                generatedAt=now.isoformat(),
                providerRequestCount=provider_request_count,
                layers=layers,
                message=unavailable_tcm.message,
            )
            self._cache(key, now, profile)
            return profile

        results: dict[str, tuple[str | None, dict[str, Any] | None, str | None]] = {'tcm': tcm_result_tuple}
        for analytic_type in _ANALYTIC_TYPES[1:]:
            result_tuple = await self._request_layer(
                polygon=field.polygon,
                study_date=effective_date_text,
                granularity=request.granularityMeters,
                analytic_type=analytic_type,
                threshold_c=request.thresholdC,
            )
            results[analytic_type] = result_tuple
            if result_tuple[0]:
                provider_request_count += 1

        layers = [_layer_summary(analytic_type, *results[analytic_type]) for analytic_type in _ANALYTIC_TYPES]
        tcm_layer = next(layer for layer in layers if layer.analyticType == 'tcm')
        time_layer = next(layer for layer in layers if layer.analyticType == 'time_of_measure')
        exceedance_layer = next(layer for layer in layers if layer.analyticType == 'exceedance')
        persistence_layer = next(layer for layer in layers if layer.analyticType == 'persistence')
        study_date = date.fromisoformat(effective_date_text)

        hottest = max(tcm_layer.cells, key=lambda cell: cell.value)
        peak_hour_utc: int | None = None
        if time_layer.status == 'verified' and time_layer.cells:
            def center(cell: AgricultureFieldHeatCell) -> tuple[float, float]:
                points = cell.polygon[:-1] if len(cell.polygon) > 1 and cell.polygon[0] == cell.polygon[-1] else cell.polygon
                return (
                    sum(point.lat for point in points) / len(points),
                    sum(point.lng for point in points) / len(points),
                )

            hot_lat, hot_lng = center(hottest)
            closest = min(
                time_layer.cells,
                key=lambda cell: (center(cell)[0] - hot_lat) ** 2 + (center(cell)[1] - hot_lng) ** 2,
            )
            peak_hour_utc = int(round(closest.value)) % 24

        if peak_hour_utc is None:
            _, tcm_result, _ = results['tcm']
            map_data = tcm_result.get('map_data') if isinstance(tcm_result, dict) and isinstance(tcm_result.get('map_data'), dict) else {}
            features = map_data.get('features') if isinstance(map_data.get('features'), list) else []
            if features:
                hottest_feature = max(
                    (feature for feature in features if _tcm_temperature(feature) is not None),
                    key=lambda feature: _tcm_temperature(feature) or float('-inf'),
                )
                peak_hour_utc = _hourly_peak_hour(hottest_feature)

        missing = [layer.analyticType for layer in layers if layer.status != 'verified']
        status = 'verified' if not missing else 'partial'
        fallback_note = (
            f'Current local day had no usable field temperature cells; using the latest verified daily evidence from {effective_date_text}. '
            if effective_date_text != requested_date_text
            else ''
        )
        layer_note = (
            'Field profile verified across temperature, peak timing, exceedance and persistence.'
            if not missing
            else f"Field temperature is verified; optional layer(s) unavailable: {', '.join(missing)}."
        )

        profile = AgricultureFieldHeatProfile(
            siteId=site_id,
            fieldId=field.id,
            fieldName=field.name,
            date=effective_date_text,
            timezoneName=timezone_name,
            thresholdC=request.thresholdC,
            granularityMeters=request.granularityMeters,
            dataStatus=status,
            generatedAt=now.isoformat(),
            providerRequestCount=provider_request_count,
            minTemperatureC=tcm_layer.minValue,
            meanTemperatureC=tcm_layer.meanValue,
            maxTemperatureC=tcm_layer.maxValue,
            peakHourUtc=peak_hour_utc,
            peakHourLocal=_local_hour_label(peak_hour_utc, study_date, timezone_name),
            meanHoursAboveThreshold=exceedance_layer.meanValue if exceedance_layer.status == 'verified' else None,
            maxHoursAboveThreshold=exceedance_layer.maxValue if exceedance_layer.status == 'verified' else None,
            meanPersistenceHours=persistence_layer.meanValue if persistence_layer.status == 'verified' else None,
            maxPersistenceHours=persistence_layer.maxValue if persistence_layer.status == 'verified' else None,
            layers=layers,
            message=f'{fallback_note}{layer_note}',
        )
        self._cache(key, now, profile)
        return profile
