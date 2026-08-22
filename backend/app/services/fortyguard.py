from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from app.core.config import Settings
from app.schemas import Site


class FortyGuardConfigurationError(RuntimeError):
    pass


class FortyGuardAPIError(RuntimeError):
    pass


@dataclass(slots=True)
class FortyGuardObservation:
    temperature_c: float
    humidity_percent: float
    heat_index_c: float
    apparent_temperature_c: float
    observed_at: str | None
    provider_payload: dict[str, Any]


class FortyGuardClient:
    """Server-side client for the actual FortyGuard asynchronous API contract.

    HeatShield first requests a TCM heatmap to obtain provider-verified site
    temperature, then supplies that temperature to /v1/env_params. Both calls
    are asynchronous jobs resolved through /v1/status/{activity_id}.
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

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = f"{self.settings.fortyguard_base_url.rstrip('/')}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.settings.fortyguard_timeout_seconds) as client:
                response = await client.request(method, url, headers=self.headers, **kwargs)
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise FortyGuardAPIError('FortyGuard request timed out.') from exc
        except httpx.HTTPStatusError as exc:
            raise FortyGuardAPIError(f'FortyGuard returned HTTP {exc.response.status_code}.') from exc
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
                raise FortyGuardAPIError(f'FortyGuard activity {activity_id} failed.')
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
    def _extract_temperature(cls, result: dict[str, Any], site: Site) -> tuple[float, dict[str, Any]]:
        map_data = result.get('map_data')
        if not isinstance(map_data, dict):
            raise FortyGuardAPIError('FortyGuard heatmap result is missing map_data.')
        features = map_data.get('features')
        if not isinstance(features, list):
            raise FortyGuardAPIError('FortyGuard heatmap contains no spatial features.')

        for feature in features:
            if not isinstance(feature, dict):
                continue
            properties = feature.get('properties')
            geometry = feature.get('geometry')
            if not isinstance(properties, dict) or not isinstance(geometry, dict):
                continue
            value = properties.get('average_temperature', properties.get('temperature'))
            coordinates = geometry.get('coordinates')
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            if geometry.get('type') != 'Polygon' or not isinstance(coordinates, list) or not coordinates:
                continue
            ring = coordinates[0]
            if isinstance(ring, list) and cls._point_in_ring(site.center.lng, site.center.lat, ring):
                return float(value), feature

        raise FortyGuardAPIError('No containing FortyGuard temperature tile was found for this site.')

    @staticmethod
    def _number_at(value: Any, index: int = 0) -> float | None:
        candidate = value[index] if isinstance(value, list) and len(value) > index else value
        if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
            return float(candidate)
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

    async def fetch_observation(self, *, site: Site) -> FortyGuardObservation:
        _ = self.headers  # Validate configuration before any work is performed.
        now = datetime.now().astimezone()
        date_time = {
            'start_date': now.date().isoformat(),
            'start_time': now.strftime('%H:%M'),
            'filter_type': 1,
        }
        heatmap_payload = {
            'polygon_aoi': self._geojson_polygon(site),
            'date_time': date_time,
            'granularity': self.settings.fortyguard_granularity_meters,
            'analytic_type': 'tcm',
        }
        heatmap_activity_id = await self._submit('/v1/heatmap', heatmap_payload)
        heatmap_result = await self._wait(heatmap_activity_id)
        temperature, selected_feature = self._extract_temperature(heatmap_result, site)

        environment_payload = {
            'latitude': site.center.lat,
            'longitude': site.center.lng,
            'temperature': temperature,
            'date_time': date_time,
        }
        environment_activity_id = await self._submit('/v1/env_params', environment_payload)
        environment_result = await self._wait(environment_activity_id)
        humidity, heat_index, apparent, observed_at, environment_raw = self._extract_environment(environment_result)

        return FortyGuardObservation(
            temperature_c=temperature,
            humidity_percent=humidity,
            heat_index_c=heat_index,
            apparent_temperature_c=apparent,
            observed_at=observed_at,
            provider_payload={
                'heatmap_activity_id': heatmap_activity_id,
                'environment_activity_id': environment_activity_id,
                'selected_heatmap_feature': selected_feature,
                'environment': environment_raw,
            },
        )
