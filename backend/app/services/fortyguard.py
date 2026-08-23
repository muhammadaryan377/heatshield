from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from timezonefinder import TimezoneFinder

from app.core.config import Settings
from app.schemas import Coordinate, Site


class FortyGuardConfigurationError(RuntimeError):
    pass


class FortyGuardAPIError(RuntimeError):
    pass


class FortyGuardNoTilesError(FortyGuardAPIError):
    """A completed heatmap job had no temperature cells for the requested hour."""


@dataclass(slots=True)
class FortyGuardObservation:
    temperature_c: float
    humidity_percent: float
    heat_index_c: float
    apparent_temperature_c: float
    observed_at: str
    source_age_hours: int
    timezone_name: str
    provider_payload: dict[str, Any]


@lru_cache(maxsize=1)
def _timezone_finder() -> TimezoneFinder:
    # Offline coordinate -> IANA timezone lookup. No Google/provider request is
    # needed and the site's clock never depends on the HeatShield server clock.
    return TimezoneFinder(in_memory=True)


# App-process cache. Site intelligence is read frequently by the UI; a short
# cache prevents refreshes from repeatedly spending completed provider jobs.
_OBSERVATION_CACHE: dict[str, tuple[datetime, FortyGuardObservation]] = {}


class FortyGuardClient:
    """Server-side client for the actual FortyGuard asynchronous API contract.

    HeatShield first requests a TCM heatmap to obtain provider-verified site
    temperature, then supplies that exact temperature and timestamp to
    /v1/env_params. Both calls are asynchronous jobs resolved through
    /v1/status/{activity_id}.
    """

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def headers(self) -> dict[str, str]:
        if not self.settings.fortyguard_api_key:
            raise FortyGuardConfigurationError('FortyGuard API key is not configured.')
        return {
            'api-key': self.settings.fortyguard_api_key,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

    @staticmethod
    def _safe_error_detail(response: httpx.Response) -> str:
        """Extract a short provider error without ever exposing request headers/secrets."""
        try:
            body = response.json()
        except ValueError:
            text = response.text.strip()
            return text[:240] if text else 'No provider error detail was returned.'

        if isinstance(body, dict):
            for key in ('message', 'detail', 'error'):
                value = body.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()[:240]
            data = body.get('data')
            if isinstance(data, dict):
                for key in ('message', 'detail', 'error'):
                    value = data.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()[:240]
        return 'No provider error detail was returned.'

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = f"{self.settings.fortyguard_base_url.rstrip('/')}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.settings.fortyguard_timeout_seconds) as client:
                response = await client.request(method, url, headers=self.headers, **kwargs)
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise FortyGuardAPIError('FortyGuard request timed out.') from exc
        except httpx.HTTPStatusError as exc:
            detail = self._safe_error_detail(exc.response)
            raise FortyGuardAPIError(
                f'FortyGuard returned HTTP {exc.response.status_code}: {detail}'
            ) from exc
        except httpx.RequestError as exc:
            raise FortyGuardAPIError('Unable to reach FortyGuard.') from exc

        try:
            body = response.json()
        except ValueError as exc:
            raise FortyGuardAPIError('FortyGuard returned invalid JSON.') from exc
        if not isinstance(body, dict):
            raise FortyGuardAPIError('FortyGuard returned an invalid response object.')
        return body

    async def _submit(self, endpoint: str, payload: dict[str, Any]) -> str:
        body = await self._request('POST', endpoint, json=payload)
        data = body.get('data')
        activity_id = data.get('activity_id') if isinstance(data, dict) else None
        if not isinstance(activity_id, str) or not activity_id.strip():
            raise FortyGuardAPIError('FortyGuard response is missing activity_id.')
        return activity_id

    async def _wait(self, activity_id: str) -> dict[str, Any]:
        for attempt in range(self.settings.fortyguard_max_poll_attempts):
            body = await self._request('GET', f'/v1/status/{activity_id}')
            data = body.get('data')
            if not isinstance(data, dict):
                raise FortyGuardAPIError('FortyGuard status response is missing data.')
            state = str(data.get('status', '')).strip().casefold()
            if state in {'completed', 'succeeded'}:
                result = data.get('result')
                if not isinstance(result, dict):
                    raise FortyGuardAPIError('Completed FortyGuard job is missing result.')
                return result
            if state in {'failed', 'error'}:
                provider_message = data.get('message') or data.get('error') or body.get('message')
                detail = f': {provider_message}' if isinstance(provider_message, str) and provider_message.strip() else ''
                raise FortyGuardAPIError(f'FortyGuard activity {activity_id} failed{detail}.')
            if attempt + 1 < self.settings.fortyguard_max_poll_attempts:
                await asyncio.sleep(self.settings.fortyguard_poll_interval_seconds)
        raise FortyGuardAPIError('FortyGuard activity did not complete before timeout.')

    @staticmethod
    def _geojson_polygon(site: Site) -> dict[str, Any]:
        points = site.polygon
        if len(points) < 3:
            raise FortyGuardAPIError('Site polygon needs at least three points.')
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

    @staticmethod
    def _point_in_ring(longitude: float, latitude: float, ring: list[list[Any]]) -> bool:
        # Treat a point on a tile/site edge as contained. Heatmap tiles commonly
        # share boundaries, and the ray-casting test alone excludes some edges.
        epsilon = 1e-10
        for index, position in enumerate(ring):
            previous = ring[index - 1]
            if len(position) < 2 or len(previous) < 2:
                return False
            x1, y1 = previous[0], previous[1]
            x2, y2 = position[0], position[1]
            if not all(isinstance(value, (int, float)) for value in (x1, y1, x2, y2)):
                return False
            cross = (longitude - x1) * (y2 - y1) - (latitude - y1) * (x2 - x1)
            if (
                abs(cross) <= epsilon
                and min(x1, x2) - epsilon <= longitude <= max(x1, x2) + epsilon
                and min(y1, y2) - epsilon <= latitude <= max(y1, y2) + epsilon
            ):
                return True

        inside = False
        j = len(ring) - 1
        for i, position in enumerate(ring):
            previous = ring[j]
            if len(position) < 2 or len(previous) < 2:
                return False
            xi, yi = position[0], position[1]
            xj, yj = previous[0], previous[1]
            if not all(isinstance(value, (int, float)) for value in (xi, yi, xj, yj)):
                return False
            intersects = (yi > latitude) != (yj > latitude) and longitude < (
                (xj - xi) * (latitude - yi) / (yj - yi) + xi
            )
            if intersects:
                inside = not inside
            j = i
        return inside

    @classmethod
    def _analysis_coordinate(cls, site: Site) -> Coordinate:
        """Choose a provider sampling point guaranteed to be inside the saved AOI.

        The UI stores a convenient display center, but a simple vertex average can
        fall outside a concave polygon. FortyGuard TCM may still return valid cells
        in that case while a center-only lookup fails. We therefore trust the saved
        center only when it is inside the boundary, then derive a safe in-polygon
        point deterministically when needed.
        """
        if len(site.polygon) < 3:
            raise FortyGuardAPIError('Site polygon needs at least three points.')

        ring = [[point.lng, point.lat] for point in site.polygon]
        if ring[0] != ring[-1]:
            ring.append(ring[0])

        if cls._point_in_ring(site.center.lng, site.center.lat, ring):
            return site.center

        average = Coordinate(
            lat=sum(point.lat for point in site.polygon) / len(site.polygon),
            lng=sum(point.lng for point in site.polygon) / len(site.polygon),
        )
        if cls._point_in_ring(average.lng, average.lat, ring):
            return average

        # Edge midpoints are guaranteed to be on the saved boundary, and our
        # containment contract treats boundary points as inside. Prefer a midpoint
        # near the polygon's bounding-box center so the environmental sample is not
        # biased toward an arbitrary first vertex.
        min_lat = min(point.lat for point in site.polygon)
        max_lat = max(point.lat for point in site.polygon)
        min_lng = min(point.lng for point in site.polygon)
        max_lng = max(point.lng for point in site.polygon)
        bbox_center = Coordinate(lat=(min_lat + max_lat) / 2, lng=(min_lng + max_lng) / 2)

        candidates: list[Coordinate] = []
        for index, point in enumerate(site.polygon):
            previous = site.polygon[index - 1]
            candidates.append(Coordinate(
                lat=(point.lat + previous.lat) / 2,
                lng=(point.lng + previous.lng) / 2,
            ))
        candidates.sort(key=lambda point: (point.lat - bbox_center.lat) ** 2 + (point.lng - bbox_center.lng) ** 2)
        for candidate in candidates:
            if cls._point_in_ring(candidate.lng, candidate.lat, ring):
                return candidate

        # This should be unreachable for a valid polygon, but keep the failure
        # explicit rather than sending a coordinate outside the FortyGuard AOI.
        raise FortyGuardAPIError('HeatShield could not derive an in-boundary FortyGuard sampling coordinate.')

    @classmethod
    def _geometry_contains_point(cls, geometry: dict[str, Any], longitude: float, latitude: float) -> bool:
        coordinates = geometry.get('coordinates')
        geometry_type = geometry.get('type')
        if geometry_type == 'Polygon' and isinstance(coordinates, list) and coordinates:
            outer_ring = coordinates[0]
            return isinstance(outer_ring, list) and cls._point_in_ring(longitude, latitude, outer_ring)
        if geometry_type == 'MultiPolygon' and isinstance(coordinates, list):
            return any(
                isinstance(polygon, list)
                and bool(polygon)
                and isinstance(polygon[0], list)
                and cls._point_in_ring(longitude, latitude, polygon[0])
                for polygon in coordinates
            )
        return False

    @staticmethod
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

    @classmethod
    def _extract_temperature(cls, result: dict[str, Any], site: Site) -> tuple[float, dict[str, Any]]:
        map_data = result.get('map_data')
        if not isinstance(map_data, dict):
            raise FortyGuardAPIError('FortyGuard heatmap result is missing map_data.')
        features = map_data.get('features')
        if not isinstance(features, list):
            raise FortyGuardAPIError('FortyGuard heatmap contains no spatial features.')
        if not features:
            raise FortyGuardNoTilesError(
                'FortyGuard completed the heatmap request but returned zero temperature tiles.'
            )

        analysis_coordinate = cls._analysis_coordinate(site)
        for feature in features:
            if not isinstance(feature, dict):
                continue
            properties = feature.get('properties')
            geometry = feature.get('geometry')
            if not isinstance(properties, dict) or not isinstance(geometry, dict):
                continue
            value = cls._temperature_value(properties)
            if value is None:
                continue
            if cls._geometry_contains_point(geometry, analysis_coordinate.lng, analysis_coordinate.lat):
                return value, feature

        raise FortyGuardAPIError('No containing FortyGuard temperature tile was found inside this site AOI.')

    @staticmethod
    def _number_at(value: Any, index: int = 0) -> float | None:
        candidate = value[index] if isinstance(value, list) and len(value) > index else value
        if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
            return float(candidate)
        if isinstance(candidate, str):
            try:
                return float(candidate)
            except ValueError:
                return None
        return None

    @classmethod
    def _extract_environment(cls, result: dict[str, Any]) -> tuple[float, float, float, str | None, dict[str, Any]]:
        locations = result.get('locations')
        metadata = result.get('metadata') if isinstance(result.get('metadata'), dict) else {}
        if not isinstance(locations, list) or not locations or not isinstance(locations[0], dict):
            raise FortyGuardAPIError('FortyGuard environmental result contains no locations.')
        location = locations[0]
        parameters = location.get('parameters') if isinstance(location.get('parameters'), dict) else {}
        heat_index = cls._number_at(parameters.get('heat_index_celsius'))
        apparent = cls._number_at(parameters.get('apparent_temperature_celsius'))
        humidity = cls._number_at(parameters.get('relative_humidity_percent'))
        if heat_index is None or apparent is None or humidity is None:
            raise FortyGuardAPIError('FortyGuard environmental result is missing required parameters.')
        timestamps = metadata.get('timestamps') if isinstance(metadata.get('timestamps'), list) else []
        observed_at = str(timestamps[0]) if timestamps else None
        return humidity, heat_index, apparent, observed_at, {'location': location, 'metadata': metadata}

    @staticmethod
    def _date_time(candidate: datetime) -> dict[str, Any]:
        return {
            'start_date': candidate.date().isoformat(),
            'start_time': candidate.strftime('%H:%M'),
            'filter_type': 1,
        }

    @classmethod
    def _site_timezone(cls, site: Site) -> tuple[str, ZoneInfo]:
        analysis_coordinate = cls._analysis_coordinate(site)
        timezone_name = _timezone_finder().timezone_at(
            lng=analysis_coordinate.lng,
            lat=analysis_coordinate.lat,
        )
        if not timezone_name:
            return 'UTC', ZoneInfo('UTC')
        try:
            return timezone_name, ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            return 'UTC', ZoneInfo('UTC')

    def _candidate_local_hours(self, site: Site, now_utc: datetime) -> tuple[str, list[datetime]]:
        timezone_name, site_timezone = self._site_timezone(site)
        local_now = now_utc.astimezone(site_timezone)
        current_hour = local_now.replace(minute=0, second=0, microsecond=0)
        fallback_count = max(0, self.settings.fortyguard_recent_hour_fallbacks)
        return timezone_name, [
            current_hour - timedelta(hours=offset)
            for offset in range(fallback_count + 1)
        ]

    def _cached_observation(self, site_id: str, now_utc: datetime) -> FortyGuardObservation | None:
        ttl = max(0, self.settings.fortyguard_cache_ttl_seconds)
        if ttl == 0:
            return None
        cached = _OBSERVATION_CACHE.get(site_id)
        if not cached:
            return None
        cached_at, observation = cached
        if (now_utc - cached_at).total_seconds() <= ttl:
            return observation
        _OBSERVATION_CACHE.pop(site_id, None)
        return None

    async def fetch_observation(
        self,
        *,
        site: Site,
        now_utc: datetime | None = None,
    ) -> FortyGuardObservation:
        _ = self.headers  # Validate configuration before any work is performed.
        request_now = now_utc or datetime.now(timezone.utc)
        if request_now.tzinfo is None:
            request_now = request_now.replace(tzinfo=timezone.utc)
        request_now = request_now.astimezone(timezone.utc)

        cached = self._cached_observation(site.id, request_now)
        if cached is not None:
            return cached

        analysis_coordinate = self._analysis_coordinate(site)
        timezone_name, candidates = self._candidate_local_hours(site, request_now)
        polygon_aoi = self._geojson_polygon(site)
        attempted_activity_ids: list[str] = []

        selected_candidate: datetime | None = None
        selected_feature: dict[str, Any] | None = None
        selected_result: dict[str, Any] | None = None
        temperature: float | None = None
        source_age_hours = 0

        for age_hours, candidate in enumerate(candidates):
            date_time = self._date_time(candidate)
            heatmap_payload = {
                'polygon_aoi': polygon_aoi,
                'date_time': date_time,
                'granularity': self.settings.fortyguard_granularity_meters,
                'analytic_type': 'tcm',
            }
            activity_id = await self._submit('/v1/heatmap', heatmap_payload)
            attempted_activity_ids.append(activity_id)
            heatmap_result = await self._wait(activity_id)

            try:
                temperature, selected_feature = self._extract_temperature(heatmap_result, site)
            except FortyGuardNoTilesError:
                continue

            selected_candidate = candidate
            selected_result = heatmap_result
            source_age_hours = age_hours
            break

        if selected_candidate is None or selected_feature is None or selected_result is None or temperature is None:
            attempts = len(candidates)
            raise FortyGuardAPIError(
                f'FortyGuard returned zero temperature tiles for {attempts} recent '
                f'{timezone_name} whole-hour request(s).'
            )

        matched_date_time = self._date_time(selected_candidate)
        environment_payload = {
            'latitude': analysis_coordinate.lat,
            'longitude': analysis_coordinate.lng,
            'temperature': temperature,
            'date_time': matched_date_time,
        }
        environment_activity_id = await self._submit('/v1/env_params', environment_payload)
        environment_result = await self._wait(environment_activity_id)
        humidity, heat_index, apparent, observed_at, environment_raw = self._extract_environment(environment_result)

        # If the environmental payload omits its own timestamp, preserve the exact
        # site-local heatmap timestamp instead of pretending the observation is now.
        canonical_observed_at = observed_at or selected_candidate.isoformat()
        feature_count = len((selected_result.get('map_data') or {}).get('features') or [])

        observation = FortyGuardObservation(
            temperature_c=temperature,
            humidity_percent=humidity,
            heat_index_c=heat_index,
            apparent_temperature_c=apparent,
            observed_at=canonical_observed_at,
            source_age_hours=source_age_hours,
            timezone_name=timezone_name,
            provider_payload={
                'heatmap_activity_id': attempted_activity_ids[-1],
                'heatmap_attempt_activity_ids': attempted_activity_ids,
                'environment_activity_id': environment_activity_id,
                'requested_date_time': matched_date_time,
                'site_timezone': timezone_name,
                'source_age_hours': source_age_hours,
                'analysis_coordinate': {
                    'lat': analysis_coordinate.lat,
                    'lng': analysis_coordinate.lng,
                },
                'heatmap_feature_count': feature_count,
                'heatmap_stats': selected_result.get('stats_data'),
                'selected_heatmap_feature': selected_feature,
                'environment': environment_raw,
            },
        )

        if self.settings.fortyguard_cache_ttl_seconds > 0:
            _OBSERVATION_CACHE[site.id] = (request_now, observation)
        return observation
