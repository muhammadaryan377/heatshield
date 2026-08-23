from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha1
from typing import Any

from app.core.config import Settings
from app.schemas import Coordinate, ThermalMapRequest, ThermalMapResponse, ThermalTile
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.store import HeatShieldStore


_THERMAL_CACHE: dict[str, tuple[datetime, ThermalMapResponse]] = {}


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
        intersects = (current.lat > point.lat) != (previous.lat > point.lat) and point.lng < (
            (previous.lng - current.lng) * (point.lat - current.lat) / (previous.lat - current.lat) + current.lng
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _validate_custom_area(site_polygon: list[Coordinate], custom_polygon: list[Coordinate]) -> None:
    for point in custom_polygon:
        if not _point_in_polygon(point, site_polygon):
            raise ValueError('Custom thermal area must stay inside the selected site boundary.')

    # Checking segment midpoints also catches the common case where two valid
    # vertices cut outside a concave site polygon.
    for index, point in enumerate(custom_polygon):
        previous = custom_polygon[index - 1]
        midpoint = Coordinate(lat=(point.lat + previous.lat) / 2, lng=(point.lng + previous.lng) / 2)
        if not _point_in_polygon(midpoint, site_polygon):
            raise ValueError('Custom thermal area edges must stay inside the selected site boundary.')


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


def _temperature_value(properties: dict[str, Any]) -> float | None:
    value = properties.get('average_temperature', properties.get('temperature'))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
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


def _feature_tiles(features: list[Any]) -> list[ThermalTile]:
    tiles: list[ThermalTile] = []
    for feature_index, feature in enumerate(features):
        if not isinstance(feature, dict):
            continue
        properties = feature.get('properties')
        geometry = feature.get('geometry')
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        temperature = _temperature_value(properties)
        if temperature is None:
            continue

        geometry_type = geometry.get('type')
        coordinates = geometry.get('coordinates')
        rings: list[list[Coordinate]] = []
        if geometry_type == 'Polygon' and isinstance(coordinates, list) and coordinates:
            ring = _coordinate_ring(coordinates[0])
            if ring:
                rings.append(ring)
        elif geometry_type == 'MultiPolygon' and isinstance(coordinates, list):
            for polygon in coordinates:
                if isinstance(polygon, list) and polygon:
                    ring = _coordinate_ring(polygon[0])
                    if ring:
                        rings.append(ring)

        for ring_index, ring in enumerate(rings):
            tiles.append(
                ThermalTile(
                    id=f'tile-{feature_index + 1}-{ring_index + 1}',
                    temperatureC=round(temperature, 3),
                    polygon=ring,
                )
            )
    return tiles


def _cache_key(site_id: str, request: ThermalMapRequest, points: list[Coordinate]) -> str:
    normalized = ';'.join(f'{point.lat:.6f},{point.lng:.6f}' for point in points)
    raw = f'{site_id}|{request.mode}|{request.granularityMeters}|{normalized}'
    return sha1(raw.encode('utf-8')).hexdigest()


class ThermalMapService:
    """Create a spatial temperature layer from actual FortyGuard heatmap cells.

    NWS is intentionally not used here: it can provide site-level atmospheric
    conditions, but it cannot replace FortyGuard's spatial thermal cells.

    FortyGuard can sometimes complete the newest hour without populated tiles.
    We first try the current/recent local hours. If those are empty, the map may
    fall back to the same local hour 1-3 days earlier so the Sites workspace can
    still show real FortyGuard spatial evidence. Historical anchors are labelled
    explicitly and are never presented as live conditions.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    def _cached(self, key: str, now: datetime) -> ThermalMapResponse | None:
        cached = _THERMAL_CACHE.get(key)
        if not cached:
            return None
        cached_at, response = cached
        ttl = max(0, self.settings.fortyguard_cache_ttl_seconds)
        if ttl and (now - cached_at).total_seconds() <= ttl:
            return response.model_copy(update={'cached': True})
        _THERMAL_CACHE.pop(key, None)
        return None

    def _store_cache(self, key: str, now: datetime, response: ThermalMapResponse) -> None:
        if self.settings.fortyguard_cache_ttl_seconds > 0:
            _THERMAL_CACHE[key] = (now, response)

    def _thermal_candidates(self, site, now: datetime) -> tuple[str, datetime, list[datetime]]:
        timezone_name, recent = self.fortyguard._candidate_local_hours(site, now)
        _, site_timezone = self.fortyguard._site_timezone(site)
        local_hour = now.astimezone(site_timezone).replace(minute=0, second=0, microsecond=0)

        candidates = list(recent)
        for day_offset in (1, 2, 3):
            anchor = local_hour - timedelta(days=day_offset)
            if anchor not in candidates:
                candidates.append(anchor)
        return timezone_name, local_hour, candidates

    async def generate(self, site_id: str, request: ThermalMapRequest) -> ThermalMapResponse:
        site = self.store.get_site(site_id)
        points = site.polygon if request.mode == 'site' else list(request.polygon or [])
        if len(points) < 3:
            raise ValueError('Thermal map area needs at least three map points.')
        if request.mode == 'custom':
            _validate_custom_area(site.polygon, points)

        now = datetime.now(timezone.utc)
        key = _cache_key(site.id, request, points)
        cached = self._cached(key, now)
        if cached is not None:
            return cached

        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            response = ThermalMapResponse(
                siteId=site.id,
                mode=request.mode,
                dataStatus='configuration_required',
                granularityMeters=request.granularityMeters,
                message='FortyGuard API key is not configured. Spatial heatmap tiles require FortyGuard.',
            )
            self._store_cache(key, now, response)
            return response

        timezone_name, local_hour, candidates = self._thermal_candidates(site, now)
        polygon_aoi = _geojson_polygon(points)
        attempted = 0

        try:
            for candidate in candidates:
                attempted += 1
                payload = {
                    'polygon_aoi': polygon_aoi,
                    'date_time': self.fortyguard._date_time(candidate),
                    'granularity': request.granularityMeters,
                    'analytic_type': 'tcm',
                }
                activity_id = await self.fortyguard._submit('/v1/heatmap', payload)
                result = await self.fortyguard._wait(activity_id)
                map_data = result.get('map_data') if isinstance(result.get('map_data'), dict) else {}
                features = map_data.get('features') if isinstance(map_data.get('features'), list) else []
                tiles = _feature_tiles(features)
                if not tiles:
                    continue

                temperatures = [tile.temperatureC for tile in tiles]
                hottest = max(tiles, key=lambda tile: tile.temperatureC)
                coolest = min(tiles, key=lambda tile: tile.temperatureC)
                age_hours = max(0, round((local_hour - candidate).total_seconds() / 3600))
                if age_hours == 0:
                    message = (
                        f'Verified FortyGuard current-hour spatial temperature cells · activity {activity_id}. '
                        'Click a cell to inspect its temperature.'
                    )
                elif age_hours <= max(1, self.settings.fortyguard_recent_hour_fallbacks):
                    message = (
                        f'Current hour had no cells; using verified FortyGuard spatial evidence from {age_hours} hour(s) earlier '
                        f'· activity {activity_id}.'
                    )
                else:
                    days = max(1, round(age_hours / 24))
                    message = (
                        f'Current/recent FortyGuard tiles were empty. Showing a verified FortyGuard historical anchor from '
                        f'{days} day(s) earlier at the same local hour · activity {activity_id}. '
                        'This is spatial baseline evidence, not a live condition.'
                    )

                response = ThermalMapResponse(
                    siteId=site.id,
                    mode=request.mode,
                    dataStatus='verified',
                    observedAt=candidate.isoformat(),
                    timezoneName=timezone_name,
                    granularityMeters=request.granularityMeters,
                    tileCount=len(tiles),
                    minTemperatureC=min(temperatures),
                    maxTemperatureC=max(temperatures),
                    meanTemperatureC=sum(temperatures) / len(temperatures),
                    hottestTileId=hottest.id,
                    coolestTileId=coolest.id,
                    tiles=tiles,
                    message=message,
                )
                self._store_cache(key, now, response)
                return response
        except FortyGuardAPIError as exc:
            response = ThermalMapResponse(
                siteId=site.id,
                mode=request.mode,
                dataStatus='unavailable',
                timezoneName=timezone_name,
                granularityMeters=request.granularityMeters,
                message=f'FortyGuard thermal map request failed: {exc}',
            )
            self._store_cache(key, now, response)
            return response

        response = ThermalMapResponse(
            siteId=site.id,
            mode=request.mode,
            dataStatus='unavailable',
            timezoneName=timezone_name,
            granularityMeters=request.granularityMeters,
            message=(
                f'FortyGuard returned no usable temperature cells after {attempted} provider-backed attempts '
                f'(current/recent hours plus 1-3 day historical anchors in {timezone_name}). No synthetic heatmap is shown.'
            ),
        )
        self._store_cache(key, now, response)
        return response
