from __future__ import annotations

from datetime import datetime, timezone

from app.core.config import Settings
from app.schemas import Conditions, NextAction, Risk, SiteIntelligence
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.store import HeatShieldStore


class SiteIntelligenceService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    async def get(self, site_id: str) -> SiteIntelligence:
        site = self.store.get_site(site_id)
        workers = self.store.list_workers(site_id)

        try:
            observation = await self.fortyguard.fetch_observation(site=site)
        except FortyGuardConfigurationError:
            return SiteIntelligence(
                site=site,
                workers=workers,
                dataStatus='configuration_required',
                statusMessage='FortyGuard API key is not configured on the HeatShield backend.',
                highExposureCount=sum(worker.risk in ('high', 'extreme') for worker in workers),
            )
        except (FortyGuardAPIError, ValueError, TypeError):
            return SiteIntelligence(
                site=site,
                workers=workers,
                dataStatus='provider_unavailable',
                statusMessage='FortyGuard did not return a verified observation for this site/time. HeatShield is not substituting estimated values.',
                highExposureCount=sum(worker.risk in ('high', 'extreme') for worker in workers),
            )

        heat_index = observation.heat_index_c
        if heat_index >= 52:
            level = 'extreme'
            summary = 'Extreme heat conditions require immediate operational controls.'
            detail = 'Pause or relocate heavy outdoor work and reassess exposed workers.'
        elif heat_index >= 39:
            level = 'high'
            summary = 'High heat exposure is present at this site.'
            detail = 'Increase hydration, shade recovery and task rotation for exposed teams.'
        elif heat_index >= 32:
            level = 'medium'
            summary = 'Heat conditions require active monitoring.'
            detail = 'Maintain hydration and review strenuous outdoor tasks.'
        else:
            level = 'low'
            summary = 'Current heat conditions are within the routine monitoring range.'
            detail = 'Continue normal precautions and keep monitoring changes.'

        next_action = None
        if workers and level in ('medium', 'high', 'extreme'):
            next_action = NextAction(
                title='Send hydration reminder to active workers',
                detail='Recommended from the latest verified FortyGuard conditions.',
                actionLabel='Send Reminder',
                dueInMinutes=15,
            )

        return SiteIntelligence(
            site=site,
            observedAt=observation.observed_at or datetime.now(timezone.utc).isoformat(),
            isLive=True,
            dataStatus='live',
            conditions=Conditions(
                temperatureC=observation.temperature_c,
                humidityPercent=observation.humidity_percent,
                heatIndexC=observation.heat_index_c,
                feelsLikeC=observation.apparent_temperature_c,
                weatherLabel='FortyGuard verified observation',
            ),
            risk=Risk(level=level, summary=summary, detail=detail),
            workers=workers,
            highExposureCount=sum(worker.risk in ('high', 'extreme') for worker in workers),
            nextAction=next_action,
        )
