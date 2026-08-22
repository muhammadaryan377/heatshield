from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone

from app.core.config import Settings
from app.schemas import SiteIntelligence
from app.services.fixtures import load_site_fixture
from app.services.fortyguard import FortyGuardClient


class SiteIntelligenceService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.fortyguard = FortyGuardClient(settings)

    async def get(self, site_id: str) -> SiteIntelligence:
        # Fixture mode exists only as a development harness. Production uses the
        # same validated response contract with live providers.
        baseline = load_site_fixture(site_id)
        if self.settings.heatshield_use_fixtures:
            return baseline

        observation = await self.fortyguard.fetch_observation(
            lat=baseline.site.center.lat,
            lng=baseline.site.center.lng,
        )

        payload = deepcopy(baseline.model_dump())
        payload['observedAt'] = observation.observed_at or datetime.now(timezone.utc).isoformat()
        payload['isLive'] = True
        payload['conditions']['temperatureC'] = observation.temperature_c
        payload['conditions']['humidityPercent'] = observation.humidity_percent
        payload['conditions']['heatIndexC'] = observation.heat_index_c
        payload['conditions']['feelsLikeC'] = observation.apparent_temperature_c

        # Risk planning remains deterministic at this layer. Screen 3 will add
        # DeepSeek reasoning after these factual values are calculated/validated.
        heat_index = observation.heat_index_c
        if heat_index >= 52:
            level = 'extreme'
        elif heat_index >= 39:
            level = 'high'
        elif heat_index >= 32:
            level = 'medium'
        else:
            level = 'low'
        payload['risk']['level'] = level

        return SiteIntelligence.model_validate(payload)
