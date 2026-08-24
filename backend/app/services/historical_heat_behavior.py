from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.core.config import Settings
from app.historical_models import (
    HistoricalHeatBehaviorRequest,
    HistoricalHeatBehaviorResponse,
    HistoricalHeatCell,
    HistoricalLayerStatus,
    HistoricalZoneSample,
)
from app.schemas import Coordinate, Site
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.store import HeatShieldStore


_HISTORY_CACHE: dict[str, tuple[datetime, HistoricalHeatBehaviorResponse]] = {}
_ANALYTICS = ('tcm', 'exceedance', 'persistence', 'time_of_measure')


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


def _features(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    map_data = result.get('map_data')
    if not isinstance(map_data, dict):
        return []
    features = map_data.get('features')
    if not isinstance(features, list):
        return []
    return [feature for feature in features if isinstance(feature, dict)]


def _props(feature: dict[str, Any]) -> dict[str, Any]:
    value = feature.get('properties')
    return value if isinstance(value, dict) else {}


def _analytic_value(feature: dict[str, Any] | None, analytic_type: str) -> float | None:
    if not feature:
        return None
    props = _props(feature)
    if analytic_type == 'tcm':
        for key in ('average_temperature', 'temperature', 'value'):
            value = _number(props.get(key))
            if value is not None:
                return value
        return None
    return _number(props.get('value'))


def _feature_key(feature: dict[str, Any], index: int) -> str:
    props = _props(feature)
    tile_id = props.get('tile_id', feature.get('id'))
    return str(tile_id) if tile_id is not None else f'index-{index}'


def _geometry(feature: dict[str, Any]) -> dict[str, Any] | None:
    value = feature.get('geometry')
    return value if isinstance(value, dict) else None


def _polygon(feature: dict[str, Any]) -> list[Coordinate]:
    geometry = _geometry(feature)
    if not geometry:
        return []
    coordinates = geometry.get('coordinates')
    ring: Any = None
    if geometry.get('type') == 'Polygon' and isinstance(coordinates, list) and coordinates:
        ring = coordinates[0]
    elif geometry.get('type') == 'MultiPolygon' and isinstance(coordinates, list) and coordinates and coordinates[0]:
        ring = coordinates[0][0]
    if not isinstance(ring, list):
        return []
    output: list[Coordinate] = []
    for position in ring:
        if not isinstance(position, list) or len(position) < 2:
            continue
        lng, lat = position[0], position[1]
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            output.append(Coordinate(lat=float(lat), lng=float(lng)))
    if len(output) > 1 and output[0] == output[-1]:
        output.pop()
    return output


def _find_containing(features: list[dict[str, Any]], latitude: float, longitude: float) -> dict[str, Any] | None:
    for feature in features:
        geometry = _geometry(feature)
        if geometry and FortyGuardClient._geometry_contains_point(geometry, longitude, latitude):
            return feature
    return None


def _portable_hour_label(moment: datetime) -> str:
    return moment.strftime('%I:%M %p').lstrip('0')


def _local_hour(hour_utc: int | None, reference_date: date, timezone_name: str) -> tuple[str | None, str | None]:
    if hour_utc is None:
        return None, None
    try:
        site_timezone = ZoneInfo(timezone_name)
    except Exception:
        site_timezone = ZoneInfo('UTC')
    start = datetime(reference_date.year, reference_date.month, reference_date.day, hour_utc % 24, tzinfo=timezone.utc).astimezone(site_timezone)
    end = start + timedelta(hours=1)
    return _portable_hour_label(start), f'{_portable_hour_label(start)}–{_portable_hour_label(end)}'


def _layer_status(
    analytic_type: str,
    activity_id: str | None,
    result: dict[str, Any] | None,
    error: str | None,
) -> HistoricalLayerStatus:
    features = _features(result)
    values = [
        value
        for feature in features
        if (value := _analytic_value(feature, analytic_type)) is not None
    ]
    stats = result.get('stats_data') if isinstance(result, dict) and isinstance(result.get('stats_data'), dict) else {}
    units = '°C' if analytic_type == 'tcm' else str(stats.get('units') or 'hour')
    if not values:
        return HistoricalLayerStatus(
            analyticType=analytic_type,
            status='unavailable',
            activityId=activity_id,
            cellCount=len(features),
            units=units,
            message=error or 'FortyGuard completed this historical layer but returned no usable cells.',
        )
    return HistoricalLayerStatus(
        analyticType=analytic_type,
        status='verified',
        activityId=activity_id,
        cellCount=len(values),
        units=units,
        minValue=min(values),
        maxValue=max(values),
        meanValue=sum(values) / len(values),
    )


class HistoricalHeatBehaviorService:
    """Build evidence-bound historical heat intelligence for one saved site.

    Each run submits four shared site-wide FortyGuard heatmaps: TCM temperature,
    exceedance, persistence, and time_of_measure. Saved site zones are joined
    locally against those shared grids, so adding zones does not spend extra
    provider calls. The API archive begins at 2019-01-01; a single provider
    range request is kept to at most 31 completed calendar days.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    @staticmethod
    def _resolve_range(site: Site, request: HistoricalHeatBehaviorRequest) -> tuple[date, date, str]:
        timezone_name, site_timezone = FortyGuardClient._site_timezone(site)
        today = datetime.now(timezone.utc).astimezone(site_timezone).date()
        latest_completed_day = today - timedelta(days=1)
        if request.startDate and request.endDate:
            try:
                start = date.fromisoformat(request.startDate)
                end = date.fromisoformat(request.endDate)
            except ValueError as exc:
                raise ValueError('Historical dates must use YYYY-MM-DD.') from exc
        else:
            end = latest_completed_day
            start = end - timedelta(days=29)
        if start < date(2019, 1, 1):
            raise ValueError('FortyGuard historical archive starts at 2019-01-01.')
        if end > latest_completed_day:
            raise ValueError('Historical intelligence uses completed days only; choose yesterday or earlier.')
        if start > end:
            raise ValueError('Historical startDate must be on or before endDate.')
        if (end - start).days + 1 > 31:
            raise ValueError('A detailed FortyGuard historical run is limited to 31 days. Compare additional periods in separate runs.')
        return start, end, timezone_name

    def _cache_key(self, site_id: str, start: date, end: date, request: HistoricalHeatBehaviorRequest) -> str:
        return f'{site_id}|{start.isoformat()}|{end.isoformat()}|{request.thresholdF:.3f}|{request.granularityMeters}'

    def _cached(self, key: str, now: datetime) -> HistoricalHeatBehaviorResponse | None:
        cached = _HISTORY_CACHE.get(key)
        if not cached:
            return None
        cached_at, response = cached
        ttl = max(0, self.settings.fortyguard_cache_ttl_seconds)
        if ttl and (now - cached_at).total_seconds() <= ttl:
            return response.model_copy(update={'cached': True})
        _HISTORY_CACHE.pop(key, None)
        return None

    def _cache(self, key: str, now: datetime, response: HistoricalHeatBehaviorResponse) -> None:
        if self.settings.fortyguard_cache_ttl_seconds > 0:
            _HISTORY_CACHE[key] = (now, response)

    async def _request_layer(
        self,
        site: Site,
        start: date,
        end: date,
        granularity: int,
        analytic_type: str,
        threshold_c: float,
    ) -> tuple[str | None, dict[str, Any] | None, str | None]:
        payload: dict[str, Any] = {
            'polygon_aoi': self.fortyguard._geojson_polygon(site),
            'date_time': {
                'start_date': start.isoformat(),
                'end_date': end.isoformat(),
                'filter_type': 4,
            },
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

    def _zones(
        self,
        site: Site,
        tcm_features: list[dict[str, Any]],
        exceedance_features: list[dict[str, Any]],
        persistence_features: list[dict[str, Any]],
        time_features: list[dict[str, Any]],
        reference_date: date,
        timezone_name: str,
    ) -> list[HistoricalZoneSample]:
        output: list[HistoricalZoneSample] = []
        for zone in site.zones:
            temperature = _analytic_value(
                _find_containing(tcm_features, zone.center.lat, zone.center.lng), 'tcm'
            )
            exceedance = _analytic_value(
                _find_containing(exceedance_features, zone.center.lat, zone.center.lng), 'exceedance'
            )
            persistence = _analytic_value(
                _find_containing(persistence_features, zone.center.lat, zone.center.lng), 'persistence'
            )
            peak_raw = _analytic_value(
                _find_containing(time_features, zone.center.lat, zone.center.lng), 'time_of_measure'
            )
            peak_hour = int(round(peak_raw)) % 24 if peak_raw is not None else None
            peak_local, _ = _local_hour(peak_hour, reference_date, timezone_name)
            count = sum(value is not None for value in (temperature, exceedance, persistence, peak_hour))
            status = 'complete' if count == 4 else 'partial' if count else 'unmatched'
            output.append(HistoricalZoneSample(
                zoneId=zone.id,
                zoneName=zone.name,
                zoneType=zone.type,
                evidenceStatus=status,
                temperatureC=temperature,
                exceedanceHours=exceedance,
                persistenceHours=persistence,
                peakHourUtc=peak_hour,
                peakHourLocal=peak_local,
            ))
        return sorted(
            output,
            key=lambda item: item.exceedanceHours if item.exceedanceHours is not None else -1,
            reverse=True,
        )

    async def generate(self, site_id: str, request: HistoricalHeatBehaviorRequest) -> HistoricalHeatBehaviorResponse:
        site = self.store.get_site(site_id)
        start, end, timezone_name = self._resolve_range(site, request)
        threshold_c = (request.thresholdF - 32.0) * 5.0 / 9.0
        day_count = (end - start).days + 1
        now = datetime.now(timezone.utc)
        key = self._cache_key(site.id, start, end, request)
        cached = self._cached(key, now)
        if cached is not None:
            return cached

        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            return HistoricalHeatBehaviorResponse(
                siteId=site.id,
                siteName=site.name,
                startDate=start.isoformat(),
                endDate=end.isoformat(),
                dayCount=day_count,
                thresholdF=request.thresholdF,
                thresholdC=threshold_c,
                timezoneName=timezone_name,
                granularityMeters=request.granularityMeters,
                dataStatus='configuration_required',
                generatedAt=now.isoformat(),
                message='FortyGuard API key is not configured. Historical Heat Intelligence requires FortyGuard.',
            )

        raw: dict[str, tuple[str | None, dict[str, Any] | None, str | None]] = {}
        for analytic_type in _ANALYTICS:
            raw[analytic_type] = await self._request_layer(
                site,
                start,
                end,
                request.granularityMeters,
                analytic_type,
                threshold_c,
            )

        layers = [_layer_status(name, *raw[name]) for name in _ANALYTICS]
        verified_count = sum(layer.status == 'verified' for layer in layers)
        provider_count = sum(1 for activity_id, _, _ in raw.values() if activity_id)

        tcm_features = _features(raw['tcm'][1])
        exceedance_features = _features(raw['exceedance'][1])
        persistence_features = _features(raw['persistence'][1])
        time_features = _features(raw['time_of_measure'][1])

        feature_sets = [
            features
            for features in (tcm_features, exceedance_features, persistence_features, time_features)
            if features
        ]
        base_features = max(feature_sets, key=len) if feature_sets else []
        indexed = {
            'tcm': {_feature_key(feature, index): feature for index, feature in enumerate(tcm_features)},
            'exceedance': {_feature_key(feature, index): feature for index, feature in enumerate(exceedance_features)},
            'persistence': {_feature_key(feature, index): feature for index, feature in enumerate(persistence_features)},
            'time_of_measure': {_feature_key(feature, index): feature for index, feature in enumerate(time_features)},
        }
        reference_date = start + timedelta(days=(end - start).days // 2)
        cells: list[HistoricalHeatCell] = []
        for index, feature in enumerate(base_features):
            key_id = _feature_key(feature, index)
            polygon = _polygon(feature)
            if len(polygon) < 3:
                continue
            temperature = _analytic_value(indexed['tcm'].get(key_id), 'tcm')
            exceedance = _analytic_value(indexed['exceedance'].get(key_id), 'exceedance')
            persistence = _analytic_value(indexed['persistence'].get(key_id), 'persistence')
            peak_raw = _analytic_value(indexed['time_of_measure'].get(key_id), 'time_of_measure')
            peak_hour = int(round(peak_raw)) % 24 if peak_raw is not None else None
            peak_local, _ = _local_hour(peak_hour, reference_date, timezone_name)
            cells.append(HistoricalHeatCell(
                id=key_id,
                polygon=polygon,
                temperatureC=temperature,
                exceedanceHours=exceedance,
                persistenceHours=persistence,
                peakHourUtc=peak_hour,
                peakHourLocal=peak_local,
            ))

        temperature_values = [cell.temperatureC for cell in cells if cell.temperatureC is not None]
        exceedance_values = [cell.exceedanceHours for cell in cells if cell.exceedanceHours is not None]
        persistence_values = [cell.persistenceHours for cell in cells if cell.persistenceHours is not None]
        peak_hours = [cell.peakHourUtc for cell in cells if cell.peakHourUtc is not None]
        common_peak = Counter(peak_hours).most_common(1)[0][0] if peak_hours else None
        common_peak_local, common_period = _local_hour(common_peak, reference_date, timezone_name)
        zones = self._zones(
            site,
            tcm_features,
            exceedance_features,
            persistence_features,
            time_features,
            reference_date,
            timezone_name,
        )

        if verified_count == len(_ANALYTICS):
            data_status = 'verified'
            message = (
                'FortyGuard historical intelligence is verified across temperature, '
                'threshold exceedance, heat persistence, and peak-time layers.'
            )
        elif verified_count > 0:
            data_status = 'partial'
            missing = ', '.join(layer.analyticType for layer in layers if layer.status != 'verified')
            message = f'Historical intelligence is partial; unavailable FortyGuard layer(s): {missing}.'
        else:
            data_status = 'unavailable'
            errors = [error for _, _, error in raw.values() if error]
            message = errors[0] if errors else 'FortyGuard returned no usable historical cells for this site and period.'

        response = HistoricalHeatBehaviorResponse(
            siteId=site.id,
            siteName=site.name,
            startDate=start.isoformat(),
            endDate=end.isoformat(),
            dayCount=day_count,
            thresholdF=request.thresholdF,
            thresholdC=threshold_c,
            timezoneName=timezone_name,
            granularityMeters=request.granularityMeters,
            dataStatus=data_status,
            generatedAt=now.isoformat(),
            providerRequestCount=provider_count,
            cellCount=len(cells),
            meanTemperatureC=sum(temperature_values) / len(temperature_values) if temperature_values else None,
            minTemperatureC=min(temperature_values) if temperature_values else None,
            maxTemperatureC=max(temperature_values) if temperature_values else None,
            meanExceedanceHours=sum(exceedance_values) / len(exceedance_values) if exceedance_values else None,
            maxExceedanceHours=max(exceedance_values) if exceedance_values else None,
            meanPersistenceHours=sum(persistence_values) / len(persistence_values) if persistence_values else None,
            maxPersistenceHours=max(persistence_values) if persistence_values else None,
            commonPeakHourUtc=common_peak,
            commonPeakHourLocal=common_peak_local,
            commonPeakPeriodLocal=common_period,
            layers=layers,
            cells=cells,
            zones=zones,
            message=message,
            cached=False,
        )
        self._cache(key, now, response)
        return response
