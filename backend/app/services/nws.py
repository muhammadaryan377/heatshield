from __future__ import annotations

from dataclasses import dataclass
from math import exp
from typing import Any

import httpx

from app.core.config import Settings
from app.schemas import Site


class NWSAPIError(RuntimeError):
    pass


@dataclass(slots=True)
class NWSObservation:
    temperature_c: float
    humidity_percent: float
    heat_index_c: float
    feels_like_c: float
    wind_kph: float | None
    wind_direction: str | None
    observed_at: str
    station_id: str | None
    station_name: str | None
    description: str | None


class NWSClient:
    """Official National Weather Service fallback for US site-level conditions.

    This service is intentionally used only for current atmospheric conditions.
    It never fabricates or substitutes FortyGuard spatial thermal tiles.
    """

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def headers(self) -> dict[str, str]:
        return {
            'User-Agent': self.settings.nws_user_agent,
            'Accept': 'application/geo+json, application/json',
        }

    async def _get(self, url: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.settings.nws_timeout_seconds) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise NWSAPIError('NWS does not provide point data for this site.') from exc
            raise NWSAPIError(f'NWS returned HTTP {exc.response.status_code}.') from exc
        except httpx.TimeoutException as exc:
            raise NWSAPIError('NWS request timed out.') from exc
        except httpx.RequestError as exc:
            raise NWSAPIError('Unable to reach the National Weather Service.') from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise NWSAPIError('NWS returned invalid JSON.') from exc
        if not isinstance(payload, dict):
            raise NWSAPIError('NWS returned an invalid response object.')
        return payload

    @staticmethod
    def _qv(value: Any) -> tuple[float | None, str | None]:
        if not isinstance(value, dict):
            return None, None
        raw = value.get('value')
        number = float(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else None
        unit = value.get('unitCode') if isinstance(value.get('unitCode'), str) else None
        return number, unit

    @staticmethod
    def _temperature_c(value: Any) -> float | None:
        number, unit = NWSClient._qv(value)
        if number is None:
            return None
        if unit and ('degF' in unit or 'degree_Fahrenheit' in unit):
            return (number - 32.0) * 5.0 / 9.0
        return number

    @staticmethod
    def _wind_kph(value: Any) -> float | None:
        number, unit = NWSClient._qv(value)
        if number is None:
            return None
        if unit and ('m_s-1' in unit or 'm/s' in unit):
            return number * 3.6
        if unit and ('mi_h-1' in unit or 'mph' in unit):
            return number * 1.609344
        return number

    @staticmethod
    def _relative_humidity(temp_c: float, dewpoint_c: float) -> float:
        # Magnus approximation; used only when NWS relativeHumidity is null.
        a, b = 17.625, 243.04
        numerator = exp((a * dewpoint_c) / (b + dewpoint_c))
        denominator = exp((a * temp_c) / (b + temp_c))
        return max(0.0, min(100.0, 100.0 * numerator / denominator))

    @staticmethod
    def _heat_index_c(temp_c: float, humidity: float) -> float:
        temp_f = temp_c * 9.0 / 5.0 + 32.0
        if temp_f < 80.0 or humidity < 40.0:
            return temp_c
        r = humidity
        t = temp_f
        hi = (
            -42.379 + 2.04901523 * t + 10.14333127 * r
            - 0.22475541 * t * r - 0.00683783 * t * t
            - 0.05481717 * r * r + 0.00122874 * t * t * r
            + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r
        )
        return (hi - 32.0) * 5.0 / 9.0

    @staticmethod
    def _compass(degrees: float | None) -> str | None:
        if degrees is None:
            return None
        labels = ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')
        return labels[int((degrees % 360) / 45.0 + 0.5) % 8]

    async def fetch_observation(self, *, site: Site) -> NWSObservation:
        base = self.settings.nws_base_url.rstrip('/')
        point = await self._get(f'{base}/points/{site.center.lat:.4f},{site.center.lng:.4f}')
        point_props = point.get('properties') if isinstance(point.get('properties'), dict) else {}
        stations_url = point_props.get('observationStations')
        if not isinstance(stations_url, str) or not stations_url:
            raise NWSAPIError('NWS point response did not include observation stations.')

        stations = await self._get(stations_url)
        features = stations.get('features')
        if not isinstance(features, list) or not features:
            raise NWSAPIError('NWS returned no observation stations for this site.')

        station = next((item for item in features if isinstance(item, dict)), None)
        if station is None:
            raise NWSAPIError('NWS observation station data was invalid.')
        station_props = station.get('properties') if isinstance(station.get('properties'), dict) else {}
        station_id = station_props.get('stationIdentifier')
        if not isinstance(station_id, str) or not station_id:
            station_url = station.get('id')
            station_id = station_url.rstrip('/').split('/')[-1] if isinstance(station_url, str) else None
        if not station_id:
            raise NWSAPIError('NWS station identifier was missing.')

        observation = await self._get(f'{base}/stations/{station_id}/observations/latest')
        props = observation.get('properties') if isinstance(observation.get('properties'), dict) else {}

        temperature = self._temperature_c(props.get('temperature'))
        if temperature is None:
            raise NWSAPIError('NWS latest observation did not include temperature.')

        humidity_raw, _ = self._qv(props.get('relativeHumidity'))
        humidity = humidity_raw
        if humidity is None:
            dewpoint = self._temperature_c(props.get('dewpoint'))
            if dewpoint is not None:
                humidity = self._relative_humidity(temperature, dewpoint)
        if humidity is None:
            raise NWSAPIError('NWS latest observation did not include usable humidity.')

        heat_index = self._temperature_c(props.get('heatIndex'))
        if heat_index is None:
            heat_index = self._heat_index_c(temperature, humidity)
        wind_chill = self._temperature_c(props.get('windChill'))
        feels_like = max(temperature, heat_index)
        if heat_index <= temperature and wind_chill is not None:
            feels_like = wind_chill

        observed_at = props.get('timestamp')
        if not isinstance(observed_at, str) or not observed_at:
            raise NWSAPIError('NWS latest observation did not include a timestamp.')

        wind_direction_degrees, _ = self._qv(props.get('windDirection'))
        station_name = station_props.get('name') if isinstance(station_props.get('name'), str) else None
        description = props.get('textDescription') if isinstance(props.get('textDescription'), str) else None

        return NWSObservation(
            temperature_c=temperature,
            humidity_percent=humidity,
            heat_index_c=heat_index,
            feels_like_c=feels_like,
            wind_kph=self._wind_kph(props.get('windSpeed')),
            wind_direction=self._compass(wind_direction_degrees),
            observed_at=observed_at,
            station_id=station_id,
            station_name=station_name,
            description=description,
        )
