from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings


class FortyGuardConfigurationError(RuntimeError):
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
    """Thin server-side adapter around FortyGuard.

    The exact site intelligence endpoint remains configuration-driven so API
    credentials and hackathon endpoint changes never leak into frontend code.
    """

    def __init__(self, settings: Settings):
        self.settings = settings

    def _ensure_configured(self) -> None:
        missing = [
            name
            for name, value in (
                ('FORTYGUARD_API_KEY', self.settings.fortyguard_api_key),
                ('FORTYGUARD_BASE_URL', self.settings.fortyguard_base_url),
                ('FORTYGUARD_SITE_INTELLIGENCE_PATH', self.settings.fortyguard_site_intelligence_path),
            )
            if not value
        ]
        if missing:
            raise FortyGuardConfigurationError(f"Missing FortyGuard configuration: {', '.join(missing)}")

    async def fetch_observation(self, *, lat: float, lng: float) -> FortyGuardObservation:
        self._ensure_configured()
        assert self.settings.fortyguard_base_url
        assert self.settings.fortyguard_site_intelligence_path
        assert self.settings.fortyguard_api_key

        url = f"{self.settings.fortyguard_base_url.rstrip('/')}/{self.settings.fortyguard_site_intelligence_path.lstrip('/')}"
        headers = {
            'Authorization': f'Bearer {self.settings.fortyguard_api_key}',
            'Accept': 'application/json',
        }
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.get(url, params={'lat': lat, 'lng': lng}, headers=headers)
            response.raise_for_status()
            payload = response.json()

        return FortyGuardObservation(
            temperature_c=float(payload.get('verified_temperature_c', payload.get('temperature_c'))),
            humidity_percent=float(payload.get('relative_humidity_percent', payload.get('humidity_percent'))),
            heat_index_c=float(payload.get('heat_index_c')),
            apparent_temperature_c=float(payload.get('apparent_temperature_c', payload.get('heat_index_c'))),
            observed_at=payload.get('canonical_observation_timestamp') or payload.get('raw_provider_timestamp'),
            provider_payload=payload,
        )
