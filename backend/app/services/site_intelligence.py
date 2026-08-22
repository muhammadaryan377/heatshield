from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from app.core.config import Settings
from app.schemas import Conditions, NextAction, Risk, SiteIntelligence, Worker
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.nws import NWSAPIError, NWSClient
from app.services.store import HeatShieldStore

RiskLevel = Literal['low', 'medium', 'high', 'extreme']


# Process-local circuit breaker. Only completed zero-tile sequences trip this
# cooldown. Transport/provider errors remain retryable and are not presented as
# proof that FortyGuard itself is unavailable.
_FORTYGUARD_FAILURE_UNTIL: dict[str, datetime] = {}


def evaluate_worker_exposure(worker: Worker, heat_index_c: float) -> RiskLevel:
    """Deterministic operational screening from verified heat plus worker context."""
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


def site_risk(heat_index: float) -> Risk:
    if heat_index >= 52:
        return Risk(
            level='extreme',
            summary='Extreme heat conditions require immediate operational controls.',
            detail='Pause or relocate heavy outdoor work and reassess exposed workers.',
        )
    if heat_index >= 39:
        return Risk(
            level='high',
            summary='High heat exposure is present at this site.',
            detail='Increase hydration, shade recovery and task rotation for exposed teams.',
        )
    if heat_index >= 32:
        return Risk(
            level='medium',
            summary='Heat conditions require active monitoring.',
            detail='Maintain hydration and review strenuous outdoor tasks.',
        )
    return Risk(
        level='low',
        summary='Current heat conditions are within the routine monitoring range.',
        detail='Continue normal precautions and keep monitoring changes.',
    )


class SiteIntelligenceService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)
        self.nws = NWSClient(settings)

    def _fortyguard_in_cooldown(self, site_id: str, now: datetime) -> bool:
        until = _FORTYGUARD_FAILURE_UNTIL.get(site_id)
        if until is None:
            return False
        if until > now:
            return True
        _FORTYGUARD_FAILURE_UNTIL.pop(site_id, None)
        return False

    def _trip_fortyguard_circuit(self, site_id: str, now: datetime) -> None:
        seconds = max(0, self.settings.fortyguard_failure_cooldown_seconds)
        if seconds:
            _FORTYGUARD_FAILURE_UNTIL[site_id] = now + timedelta(seconds=seconds)

    @staticmethod
    def _is_zero_tile_error(exc: Exception) -> bool:
        message = str(exc).casefold()
        return 'zero temperature tiles' in message or 'no usable temperature cells' in message

    @staticmethod
    def _with_worker_risk(workers: list[Worker], heat_index: float) -> tuple[list[Worker], int]:
        evaluated = [
            worker.model_copy(update={'risk': evaluate_worker_exposure(worker, heat_index)})
            for worker in workers
        ]
        high_count = sum(worker.risk in ('high', 'extreme') for worker in evaluated)
        return evaluated, high_count

    def _next_action(self, workers: list[Worker], risk: Risk, source_label: str) -> NextAction | None:
        if workers and risk.level in ('medium', 'high', 'extreme'):
            return NextAction(
                title='Review exposed workers and hydration controls',
                detail=f'Recommended from the latest verified {source_label} conditions.',
                actionLabel='Review Workers',
                dueInMinutes=15,
            )
        return None

    async def _nws_fallback(
        self,
        *,
        site,
        workers: list[Worker],
        thermal_status: Literal['unavailable', 'not_configured'],
        thermal_message: str,
    ) -> SiteIntelligence:
        observation = await self.nws.fetch_observation(site=site)
        risk = site_risk(observation.heat_index_c)
        evaluated_workers, high_count = self._with_worker_risk(workers, observation.heat_index_c)
        station = observation.station_name or observation.station_id or 'NWS station'
        status_message = (
            f'Current atmospheric conditions are from the National Weather Service ({station}). '
            f'{thermal_message} Spatial FortyGuard hotspots are not inferred when current thermal cells are unavailable.'
        )
        return SiteIntelligence(
            site=site,
            observedAt=observation.observed_at,
            isLive=True,
            dataStatus='live',
            statusMessage=status_message,
            conditionSource='nws',
            conditionSourceLabel='National Weather Service',
            thermalStatus=thermal_status,
            thermalMessage=thermal_message,
            fallbackActive=True,
            conditions=Conditions(
                temperatureC=observation.temperature_c,
                humidityPercent=observation.humidity_percent,
                heatIndexC=observation.heat_index_c,
                feelsLikeC=observation.feels_like_c,
                windKph=observation.wind_kph,
                windDirection=observation.wind_direction,
                weatherLabel=observation.description or 'NWS verified observation',
            ),
            risk=risk,
            workers=evaluated_workers,
            highExposureCount=high_count,
            nextAction=self._next_action(evaluated_workers, risk, 'NWS'),
        )

    async def get(self, site_id: str) -> SiteIntelligence:
        site = self.store.get_site(site_id)
        workers = self.store.list_workers(site_id)
        now = datetime.now(timezone.utc)

        if self._fortyguard_in_cooldown(site_id, now):
            try:
                return await self._nws_fallback(
                    site=site,
                    workers=workers,
                    thermal_status='unavailable',
                    thermal_message=(
                        'Current/recent FortyGuard thermal cells returned empty results, so HeatShield is waiting briefly before retrying them. '
                        'FortyGuard remains configured; this is a live-tile availability state, not an API-key failure.'
                    ),
                )
            except NWSAPIError as exc:
                return SiteIntelligence(
                    site=site,
                    workers=workers,
                    dataStatus='provider_unavailable',
                    statusMessage=f'FortyGuard current-tile retry is in cooldown and NWS fallback failed: {exc}',
                    thermalStatus='unavailable',
                    thermalMessage='Current/recent FortyGuard thermal cells are in a short retry cooldown.',
                )

        try:
            observation = await self.fortyguard.fetch_observation(site=site)
        except FortyGuardConfigurationError:
            try:
                return await self._nws_fallback(
                    site=site,
                    workers=workers,
                    thermal_status='not_configured',
                    thermal_message='FortyGuard API key is not configured on the HeatShield backend.',
                )
            except NWSAPIError as exc:
                return SiteIntelligence(
                    site=site,
                    workers=workers,
                    dataStatus='configuration_required',
                    statusMessage=f'FortyGuard is not configured and NWS fallback failed: {exc}',
                    thermalStatus='not_configured',
                )
        except FortyGuardAPIError as exc:
            zero_tiles = self._is_zero_tile_error(exc)
            if zero_tiles:
                self._trip_fortyguard_circuit(site_id, now)
            try:
                return await self._nws_fallback(
                    site=site,
                    workers=workers,
                    thermal_status='unavailable',
                    thermal_message=(
                        'FortyGuard is configured, but no current/recent spatial temperature cells were available for this site.'
                        if zero_tiles
                        else f'FortyGuard live request could not be completed: {exc}'
                    ),
                )
            except NWSAPIError as nws_exc:
                return SiteIntelligence(
                    site=site,
                    workers=workers,
                    dataStatus='provider_unavailable',
                    statusMessage=f'FortyGuard failed ({exc}) and NWS fallback failed ({nws_exc}).',
                    thermalStatus='unavailable',
                    thermalMessage=str(exc),
                )
        except (ValueError, TypeError) as exc:
            return SiteIntelligence(
                site=site,
                workers=workers,
                dataStatus='provider_unavailable',
                statusMessage=f'HeatShield could not validate the provider response: {exc}',
                thermalStatus='unavailable',
            )

        risk = site_risk(observation.heat_index_c)
        evaluated_workers, high_count = self._with_worker_risk(workers, observation.heat_index_c)
        is_live = observation.source_age_hours == 0
        if is_live:
            status_message = None
            weather_label = 'FortyGuard live verified observation'
            thermal_status: Literal['verified', 'recent_verified'] = 'verified'
        else:
            hour_label = 'hour' if observation.source_age_hours == 1 else 'hours'
            status_message = (
                f'Current hour had no temperature tiles. Using the latest verified FortyGuard '
                f'observation from {observation.source_age_hours} {hour_label} earlier.'
            )
            weather_label = 'FortyGuard recent verified observation'
            thermal_status = 'recent_verified'

        return SiteIntelligence(
            site=site,
            observedAt=observation.observed_at,
            isLive=is_live,
            dataStatus='live',
            statusMessage=status_message,
            conditionSource='fortyguard',
            conditionSourceLabel='FortyGuard',
            thermalStatus=thermal_status,
            thermalObservedAt=observation.observed_at,
            fallbackActive=False,
            conditions=Conditions(
                temperatureC=observation.temperature_c,
                humidityPercent=observation.humidity_percent,
                heatIndexC=observation.heat_index_c,
                feelsLikeC=observation.apparent_temperature_c,
                weatherLabel=weather_label,
            ),
            risk=risk,
            workers=evaluated_workers,
            highExposureCount=high_count,
            nextAction=self._next_action(evaluated_workers, risk, 'FortyGuard'),
        )
