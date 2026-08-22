from __future__ import annotations

from typing import Literal

from app.core.config import Settings
from app.schemas import Conditions, NextAction, Risk, SiteIntelligence, Worker
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.store import HeatShieldStore

RiskLevel = Literal['low', 'medium', 'high', 'extreme']


def evaluate_worker_exposure(worker: Worker, heat_index_c: float) -> RiskLevel:
    """Deterministic operational screening from verified heat plus worker context.

    This is a HeatShield planning signal, not a medical diagnosis. It deliberately
    keeps provider measurements separate from the worker-context scoring layer.
    """

    score = 0
    if heat_index_c >= 52:
        score += 5
    elif heat_index_c >= 39:
        score += 4
    elif heat_index_c >= 32:
        score += 2
    elif heat_index_c >= 27:
        score += 1

    if worker.workIntensity == 'heavy':
        score += 2
    elif worker.workIntensity == 'moderate':
        score += 1

    if worker.sunExposure == 'direct':
        score += 2
    elif worker.sunExposure == 'partial':
        score += 1
    elif worker.sunExposure == 'indoor':
        score -= 1

    if worker.shadeAccess == 'none':
        score += 2
    elif worker.shadeAccess == 'limited':
        score += 1
    elif worker.shadeAccess == 'available':
        score -= 1

    if worker.waterAccess is False:
        score += 1

    if score >= 9:
        return 'extreme'
    if score >= 6:
        return 'high'
    if score >= 3:
        return 'medium'
    return 'low'


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
        except FortyGuardAPIError as exc:
            return SiteIntelligence(
                site=site,
                workers=workers,
                dataStatus='provider_unavailable',
                statusMessage=f'Live provider request failed: {exc}',
                highExposureCount=sum(worker.risk in ('high', 'extreme') for worker in workers),
            )
        except (ValueError, TypeError) as exc:
            return SiteIntelligence(
                site=site,
                workers=workers,
                dataStatus='provider_unavailable',
                statusMessage=f'HeatShield could not validate the provider response: {exc}',
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

        evaluated_workers = [
            worker.model_copy(update={'risk': evaluate_worker_exposure(worker, heat_index)})
            for worker in workers
        ]
        high_exposure_count = sum(worker.risk in ('high', 'extreme') for worker in evaluated_workers)

        next_action = None
        if evaluated_workers and level in ('medium', 'high', 'extreme'):
            next_action = NextAction(
                title='Send hydration reminder to active workers',
                detail='Recommended from the latest verified FortyGuard conditions.',
                actionLabel='Send Reminder',
                dueInMinutes=15,
            )

        is_live = observation.source_age_hours == 0
        if is_live:
            status_message = None
            weather_label = 'FortyGuard live verified observation'
        else:
            hour_label = 'hour' if observation.source_age_hours == 1 else 'hours'
            status_message = (
                f'Current hour had no temperature tiles. Using the latest verified FortyGuard '
                f'observation from {observation.source_age_hours} {hour_label} earlier.'
            )
            weather_label = 'FortyGuard recent verified observation'

        return SiteIntelligence(
            site=site,
            observedAt=observation.observed_at,
            isLive=is_live,
            dataStatus='live',
            statusMessage=status_message,
            conditions=Conditions(
                temperatureC=observation.temperature_c,
                humidityPercent=observation.humidity_percent,
                heatIndexC=observation.heat_index_c,
                feelsLikeC=observation.apparent_temperature_c,
                weatherLabel=weather_label,
            ),
            risk=Risk(level=level, summary=summary, detail=detail),
            workers=evaluated_workers,
            highExposureCount=high_exposure_count,
            nextAction=next_action,
        )
