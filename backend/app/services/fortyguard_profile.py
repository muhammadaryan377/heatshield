from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.core.config import Settings
from app.schemas import (
    FortyGuardDailyProfile,
    FortyGuardLayerStatus,
    FortyGuardProfileRequest,
    FortyGuardWorkerExposure,
    Site,
    Worker,
)
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.store import HeatShieldStore


_PROFILE_CACHE: dict[str, tuple[datetime, FortyGuardDailyProfile]] = {}
_ALLOWED_GRANULARITIES = {60, 80, 100}
_ANALYTIC_TYPES = ('tcm', 'time_of_measure', 'exceedance', 'persistence')


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


def _features(result: dict[str, Any]) -> list[dict[str, Any]]:
    map_data = result.get('map_data')
    if not isinstance(map_data, dict):
        return []
    raw = map_data.get('features')
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _properties(feature: dict[str, Any]) -> dict[str, Any]:
    value = feature.get('properties')
    return value if isinstance(value, dict) else {}


def _geometry(feature: dict[str, Any]) -> dict[str, Any] | None:
    value = feature.get('geometry')
    return value if isinstance(value, dict) else None


def _tile_id(feature: dict[str, Any]) -> str | None:
    props = _properties(feature)
    value = props.get('tile_id', feature.get('id'))
    return str(value) if value is not None else None


def _tcm_average_temperature(feature: dict[str, Any] | None) -> float | None:
    """Return FortyGuard's average temperature for a TCM tile.

    For a single-hour heatmap average/min/max are normally identical. For a
    single-day heatmap they are different provider fields, so average_temperature
    must not be silently replaced by max_temperature.
    """
    if not feature:
        return None
    props = _properties(feature)
    for key in ('average_temperature', 'temperature'):
        parsed = _number(props.get(key))
        if parsed is not None:
            return parsed
    return None


def _tcm_peak_temperature(feature: dict[str, Any] | None) -> float | None:
    """Return the provider's maximum temperature for a TCM tile."""
    if not feature:
        return None
    props = _properties(feature)
    parsed = _number(props.get('max_temperature'))
    if parsed is not None:
        return parsed
    return _tcm_average_temperature(feature)


def _analysis_value(feature: dict[str, Any] | None) -> float | None:
    return _number(_properties(feature).get('value')) if feature else None


def _hourly_peak_hour(feature: dict[str, Any] | None) -> int | None:
    if not feature:
        return None
    props = _properties(feature)
    values: list[tuple[float, int]] = []
    for hour in range(24):
        parsed = _number(props.get(f'{hour:02d}'))
        if parsed is not None:
            values.append((parsed, hour))
    return max(values, key=lambda item: item[0])[1] if values else None


def _find_containing(
    features: list[dict[str, Any]], *, latitude: float, longitude: float
) -> dict[str, Any] | None:
    for feature in features:
        geometry = _geometry(feature)
        if geometry and FortyGuardClient._geometry_contains_point(geometry, longitude, latitude):
            return feature
    return None


def _match_tile(features: list[dict[str, Any]], source_feature: dict[str, Any]) -> dict[str, Any] | None:
    source_id = _tile_id(source_feature)
    if source_id is not None:
        for feature in features:
            if _tile_id(feature) == source_id:
                return feature

    geometry = _geometry(source_feature)
    if not geometry:
        return None
    coordinates = geometry.get('coordinates')
    if geometry.get('type') != 'Polygon' or not isinstance(coordinates, list) or not coordinates:
        return None
    ring = coordinates[0]
    if not isinstance(ring, list):
        return None
    numeric = [
        position for position in ring
        if isinstance(position, list)
        and len(position) >= 2
        and all(isinstance(value, (int, float)) for value in position[:2])
    ]
    if not numeric:
        return None
    longitude = sum(float(position[0]) for position in numeric) / len(numeric)
    latitude = sum(float(position[1]) for position in numeric) / len(numeric)
    return _find_containing(features, latitude=latitude, longitude=longitude)


def _local_hour_label(hour_utc: int | None, study_date: date, timezone_name: str) -> str | None:
    if hour_utc is None:
        return None
    try:
        site_timezone = ZoneInfo(timezone_name)
    except Exception:
        site_timezone = ZoneInfo('UTC')
    moment = datetime(
        study_date.year,
        study_date.month,
        study_date.day,
        hour_utc % 24,
        tzinfo=timezone.utc,
    ).astimezone(site_timezone)
    display_hour = moment.hour % 12 or 12
    meridiem = 'AM' if moment.hour < 12 else 'PM'
    return f'{display_hour}:00 {meridiem}'


def _layer_status(
    analytic_type: str,
    activity_id: str | None,
    result: dict[str, Any] | None,
    error: str | None,
) -> FortyGuardLayerStatus:
    if result is None:
        return FortyGuardLayerStatus(
            analyticType=analytic_type,
            status='unavailable',
            activityId=activity_id,
            message=error,
        )

    features = _features(result)
    stats = result.get('stats_data') if isinstance(result.get('stats_data'), dict) else {}
    if analytic_type == 'tcm':
        values = [
            value for feature in features
            if (value := _tcm_average_temperature(feature)) is not None
        ]
        temperature_stats = stats.get('temperature_stats') if isinstance(stats.get('temperature_stats'), dict) else {}
        minimum = _number(temperature_stats.get('minimum'))
        maximum = _number(temperature_stats.get('maximum'))
        mean = _number(temperature_stats.get('mean'))
        units = '°C'
    else:
        values = [value for feature in features if (value := _analysis_value(feature)) is not None]
        minimum = _number(stats.get('min'))
        maximum = _number(stats.get('max'))
        mean = _number(stats.get('mean'))
        units = str(stats.get('units')) if stats.get('units') is not None else 'hour'

    if not values:
        return FortyGuardLayerStatus(
            analyticType=analytic_type,
            status='unavailable',
            activityId=activity_id,
            cellCount=len(features),
            units=units,
            message=error or 'FortyGuard completed this layer but returned no usable cells.',
        )

    return FortyGuardLayerStatus(
        analyticType=analytic_type,
        status='verified',
        activityId=activity_id,
        cellCount=len(values),
        units=units,
        minValue=minimum if minimum is not None else min(values),
        maxValue=maximum if maximum is not None else max(values),
        meanValue=mean if mean is not None else sum(values) / len(values),
    )


def _profile_key(site_id: str, request: FortyGuardProfileRequest, study_date: str) -> str:
    return f'{site_id}|{study_date}|{request.thresholdC:.3f}|{request.granularityMeters}'


class FortyGuardProfileService:
    """Build a daily FortyGuard profile from four spatial provider layers."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    def _cached(self, key: str, now: datetime) -> FortyGuardDailyProfile | None:
        cached = _PROFILE_CACHE.get(key)
        if not cached:
            return None
        cached_at, profile = cached
        ttl = max(0, self.settings.fortyguard_cache_ttl_seconds)
        if ttl and (now - cached_at).total_seconds() <= ttl:
            return profile.model_copy(update={'cached': True})
        _PROFILE_CACHE.pop(key, None)
        return None

    def _cache(self, key: str, now: datetime, profile: FortyGuardDailyProfile) -> None:
        if self.settings.fortyguard_cache_ttl_seconds > 0:
            _PROFILE_CACHE[key] = (now, profile)

    @staticmethod
    def _study_date(site: Site, requested: str | None) -> tuple[str, str]:
        timezone_name, site_timezone = FortyGuardClient._site_timezone(site)
        local_today = datetime.now(timezone.utc).astimezone(site_timezone).date()
        last_complete_day = local_today - timedelta(days=1)
        if requested:
            try:
                selected = date.fromisoformat(requested)
            except ValueError as exc:
                raise ValueError('FortyGuard profile date must use YYYY-MM-DD.') from exc
        else:
            selected = last_complete_day
        if selected < date(2019, 1, 1):
            raise ValueError('FortyGuard profile dates must be on or after 2019-01-01.')
        if selected > last_complete_day:
            raise ValueError('FortyGuard full-day profile must use a completed day (yesterday or earlier).')
        return selected.isoformat(), timezone_name

    async def _request_layer(
        self,
        *,
        site: Site,
        study_date: str,
        granularity: int,
        analytic_type: str,
        threshold_c: float,
    ) -> tuple[str | None, dict[str, Any] | None, str | None]:
        payload: dict[str, Any] = {
            'polygon_aoi': self.fortyguard._geojson_polygon(site),
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

    def _worker_exposures(
        self,
        workers: list[Worker],
        *,
        tcm_features: list[dict[str, Any]],
        time_features: list[dict[str, Any]],
        exceedance_features: list[dict[str, Any]],
        persistence_features: list[dict[str, Any]],
        study_date: date,
        timezone_name: str,
        threshold_c: float,
    ) -> list[FortyGuardWorkerExposure]:
        output: list[FortyGuardWorkerExposure] = []
        for worker in workers:
            tcm = _find_containing(
                tcm_features,
                latitude=worker.coordinate.lat,
                longitude=worker.coordinate.lng,
            )
            peak_temperature = _tcm_peak_temperature(tcm)

            time_feature = _find_containing(
                time_features,
                latitude=worker.coordinate.lat,
                longitude=worker.coordinate.lng,
            )
            time_value = _analysis_value(time_feature)
            peak_hour_utc = int(round(time_value)) if time_value is not None else _hourly_peak_hour(tcm)
            if peak_hour_utc is not None:
                peak_hour_utc %= 24

            exceedance_feature = _find_containing(
                exceedance_features,
                latitude=worker.coordinate.lat,
                longitude=worker.coordinate.lng,
            )
            persistence_feature = _find_containing(
                persistence_features,
                latitude=worker.coordinate.lat,
                longitude=worker.coordinate.lng,
            )
            exceedance = _analysis_value(exceedance_feature)
            persistence = _analysis_value(persistence_feature)

            values_present = sum(
                value is not None
                for value in (peak_temperature, peak_hour_utc, exceedance, persistence)
            )
            evidence_status = 'complete' if values_present == 4 else 'partial' if values_present else 'unmatched'

            output.append(FortyGuardWorkerExposure(
                workerId=worker.id,
                workerName=worker.name,
                role=worker.role,
                area=worker.location,
                evidenceStatus=evidence_status,
                peakTemperatureC=peak_temperature,
                peakHourUtc=peak_hour_utc,
                peakHourLocal=_local_hour_label(peak_hour_utc, study_date, timezone_name),
                hoursAboveThreshold=exceedance,
                persistenceHours=persistence,
                thresholdC=threshold_c,
            ))
        return output

    async def generate(self, site_id: str, request: FortyGuardProfileRequest) -> FortyGuardDailyProfile:
        if request.granularityMeters not in _ALLOWED_GRANULARITIES:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')

        site = self.store.get_site(site_id)
        workers = self.store.list_workers(site_id)
        study_date_text, timezone_name = self._study_date(site, request.date)
        study_date = date.fromisoformat(study_date_text)
        now = datetime.now(timezone.utc)
        cache_key = _profile_key(site.id, request, study_date_text)
        cached = self._cached(cache_key, now)
        if cached is not None:
            return cached

        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            return FortyGuardDailyProfile(
                siteId=site.id,
                siteName=site.name,
                date=study_date_text,
                timezoneName=timezone_name,
                thresholdC=request.thresholdC,
                granularityMeters=request.granularityMeters,
                dataStatus='configuration_required',
                generatedAt=now.isoformat(),
                message='FortyGuard API key is not configured. This profile requires FortyGuard.',
            )

        layer_results: dict[str, tuple[str | None, dict[str, Any] | None, str | None]] = {}
        for analytic_type in _ANALYTIC_TYPES:
            layer_results[analytic_type] = await self._request_layer(
                site=site,
                study_date=study_date_text,
                granularity=request.granularityMeters,
                analytic_type=analytic_type,
                threshold_c=request.thresholdC,
            )

        layers = [
            _layer_status(analytic_type, *layer_results[analytic_type])
            for analytic_type in _ANALYTIC_TYPES
        ]
        _, tcm_result, tcm_error = layer_results['tcm']
        tcm_features = _features(tcm_result or {})
        tcm_average_values = [
            value for feature in tcm_features
            if (value := _tcm_average_temperature(feature)) is not None
        ]
        tcm_peak_values = [
            value for feature in tcm_features
            if (value := _tcm_peak_temperature(feature)) is not None
        ]

        request_count = sum(1 for activity, _, _ in layer_results.values() if activity)
        if not tcm_average_values:
            profile = FortyGuardDailyProfile(
                siteId=site.id,
                siteName=site.name,
                date=study_date_text,
                timezoneName=timezone_name,
                thresholdC=request.thresholdC,
                granularityMeters=request.granularityMeters,
                dataStatus='unavailable',
                generatedAt=now.isoformat(),
                providerRequestCount=request_count,
                layers=layers,
                message=tcm_error or 'FortyGuard returned no usable TCM average-temperature cells for this date.',
            )
            self._cache(cache_key, now, profile)
            return profile

        time_features = _features(layer_results['time_of_measure'][1] or {})
        exceedance_features = _features(layer_results['exceedance'][1] or {})
        persistence_features = _features(layer_results['persistence'][1] or {})

        hottest_feature = max(
            (feature for feature in tcm_features if _tcm_peak_temperature(feature) is not None),
            key=lambda feature: _tcm_peak_temperature(feature) or float('-inf'),
        )
        hottest_time_feature = _match_tile(time_features, hottest_feature)
        peak_value = _analysis_value(hottest_time_feature)
        site_peak_hour_utc = (
            int(round(peak_value)) % 24
            if peak_value is not None
            else _hourly_peak_hour(hottest_feature)
        )

        exceedance_values = [
            value for feature in exceedance_features
            if (value := _analysis_value(feature)) is not None
        ]
        persistence_values = [
            value for feature in persistence_features
            if (value := _analysis_value(feature)) is not None
        ]

        worker_exposures = self._worker_exposures(
            workers,
            tcm_features=tcm_features,
            time_features=time_features,
            exceedance_features=exceedance_features,
            persistence_features=persistence_features,
            study_date=study_date,
            timezone_name=timezone_name,
            threshold_c=request.thresholdC,
        )

        missing_layers = [layer.analyticType for layer in layers if layer.status != 'verified']
        data_status = 'verified' if not missing_layers else 'partial'
        message = (
            'FortyGuard daily thermal profile verified across TCM, peak timing, exceedance and persistence.'
            if not missing_layers
            else f"FortyGuard TCM is verified; optional layer(s) unavailable: {', '.join(missing_layers)}."
        )

        profile = FortyGuardDailyProfile(
            siteId=site.id,
            siteName=site.name,
            date=study_date_text,
            timezoneName=timezone_name,
            thresholdC=request.thresholdC,
            granularityMeters=request.granularityMeters,
            dataStatus=data_status,
            generatedAt=now.isoformat(),
            providerRequestCount=request_count,
            tcmCellCount=len(tcm_average_values),
            minTemperatureC=min(tcm_average_values),
            meanTemperatureC=sum(tcm_average_values) / len(tcm_average_values),
            maxTemperatureC=max(tcm_peak_values) if tcm_peak_values else max(tcm_average_values),
            peakHourUtc=site_peak_hour_utc,
            peakHourLocal=_local_hour_label(site_peak_hour_utc, study_date, timezone_name),
            meanHoursAboveThreshold=(sum(exceedance_values) / len(exceedance_values)) if exceedance_values else None,
            maxHoursAboveThreshold=max(exceedance_values) if exceedance_values else None,
            meanPersistenceHours=(sum(persistence_values) / len(persistence_values)) if persistence_values else None,
            maxPersistenceHours=max(persistence_values) if persistence_values else None,
            layers=layers,
            workers=worker_exposures,
            message=message,
        )
        self._cache(cache_key, now, profile)
        return profile
