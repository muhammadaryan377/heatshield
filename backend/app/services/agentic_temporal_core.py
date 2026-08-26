from __future__ import annotations

from app.agentic_models import AgentTemporalEvidence, AgentTraceStep, AgentWorkerDecision, AgenticHeatPlan
from app.core.config import Settings
from app.schemas import FortyGuardProfileRequest, OperationalPlannerRequest
from app.services.agentic_decision_core import AgenticDecisionCoreService
from app.services.fortyguard_profile import FortyGuardProfileService


class TemporalAgenticDecisionCoreService(AgenticDecisionCoreService):
    """Add last-completed-day FortyGuard temporal behavior to the operational agent.

    Temporal evidence does not overwrite current/recent spatial measurements or
    manufacture a different action. It strengthens or weakens confidence and
    exposes whether the worker location has repeated threshold exceedance,
    persistence, and peak-time evidence.
    """

    def __init__(self, settings: Settings):
        super().__init__(settings)
        self.profile_service = FortyGuardProfileService(settings)

    async def generate(self, site_id: str, request: OperationalPlannerRequest) -> AgenticHeatPlan:
        base = await super().generate(site_id, request)

        try:
            profile = await self.profile_service.generate(
                site_id,
                FortyGuardProfileRequest(
                    date=None,
                    thresholdC=35.0,
                    granularityMeters=request.granularityMeters,
                ),
            )
        except Exception as exc:
            temporal_unavailable = AgentTemporalEvidence(
                status='unavailable',
                detail=f'Last-completed-day temporal profile could not be loaded: {exc}',
            )
            workers = [
                decision.model_copy(update={
                    'temporalEvidence': temporal_unavailable,
                    'trace': [
                        *decision.trace[:1],
                        AgentTraceStep(
                            stage='observe',
                            status='warning',
                            title='Observe temporal heat behavior',
                            detail='Temporal profile is unavailable, so the proposal relies on spatial/current evidence only.',
                            evidence=['No temporal values substituted.'],
                        ),
                        *decision.trace[1:],
                    ],
                    'evidenceWarnings': [*decision.evidenceWarnings, 'Daily exceedance/persistence context is unavailable.'],
                })
                for decision in base.workers
            ]
            return base.model_copy(update={
                'workers': workers,
                'historicalProfileStatus': 'unavailable',
                'warnings': [*base.warnings, 'Agent temporal profile is unavailable; spatial decision logic remains intact.'],
            })

        exposure_by_worker = {item.workerId: item for item in profile.workers}
        enriched: list[AgentWorkerDecision] = []

        for decision in base.workers:
            exposure = exposure_by_worker.get(decision.workerId)
            if profile.dataStatus not in {'verified', 'partial'}:
                temporal = AgentTemporalEvidence(
                    status='unavailable',
                    profileDate=profile.date,
                    thresholdC=profile.thresholdC,
                    detail=profile.message or 'FortyGuard temporal layers are unavailable for the last completed day.',
                )
            elif exposure is None:
                temporal = AgentTemporalEvidence(
                    status='unmatched',
                    profileDate=profile.date,
                    thresholdC=profile.thresholdC,
                    detail='The daily profile is available, but no worker-coordinate temporal match was returned.',
                )
            else:
                status = exposure.evidenceStatus
                temporal = AgentTemporalEvidence(
                    status=status,
                    profileDate=profile.date,
                    thresholdC=exposure.thresholdC,
                    peakTemperatureC=exposure.peakTemperatureC,
                    peakHourLocal=exposure.peakHourLocal,
                    hoursAboveThreshold=exposure.hoursAboveThreshold,
                    persistenceHours=exposure.persistenceHours,
                    detail=(
                        'Worker coordinate is matched to last-completed-day FortyGuard temporal layers.'
                        if status == 'complete'
                        else 'Worker coordinate has partial last-completed-day temporal evidence.'
                        if status == 'partial'
                        else 'No usable temporal cell matched the worker coordinate.'
                    ),
                )

            confidence = decision.confidenceScore
            factors = list(decision.confidenceFactors)
            evidence_warnings = list(decision.evidenceWarnings)
            rationale = decision.rationale

            if temporal.status == 'complete':
                confidence = min(100, confidence + 10)
                factors.append('Complete last-completed-day temporal exposure evidence is matched (+10).')
            elif temporal.status == 'partial':
                confidence = min(100, confidence + 5)
                factors.append('Partial last-completed-day temporal exposure evidence is matched (+5).')
            elif temporal.status in {'unmatched', 'unavailable'}:
                evidence_warnings.append('Worker temporal exposure context is incomplete.')

            temporal_bits: list[str] = []
            if temporal.hoursAboveThreshold is not None:
                temporal_bits.append(f'{temporal.hoursAboveThreshold:.1f} h above {temporal.thresholdC:.1f}°C')
            if temporal.persistenceHours is not None:
                temporal_bits.append(f'{temporal.persistenceHours:.1f} h persistence')
            if temporal.peakHourLocal:
                temporal_bits.append(f'peak near {temporal.peakHourLocal}')
            if temporal_bits:
                rationale = f'{rationale} Last-completed-day context at this worker coordinate: {", ".join(temporal_bits)}.'

            level = 'high' if confidence >= 80 else 'medium' if confidence >= 55 else 'low'
            temporal_trace = AgentTraceStep(
                stage='observe',
                status='complete' if temporal.status in {'complete', 'partial'} else 'warning',
                title='Observe temporal heat behavior',
                detail='Add last-completed-day threshold exceedance, persistence and peak-time evidence before final supervisor review.',
                evidence=[
                    f'Profile date: {temporal.profileDate or "unavailable"}',
                    f'Peak temperature: {temporal.peakTemperatureC:.1f}°C' if temporal.peakTemperatureC is not None else 'Peak temperature unavailable',
                    f'Hours above threshold: {temporal.hoursAboveThreshold:.1f} h' if temporal.hoursAboveThreshold is not None else 'Exceedance unavailable',
                    f'Persistence: {temporal.persistenceHours:.1f} h' if temporal.persistenceHours is not None else 'Persistence unavailable',
                    f'Peak time: {temporal.peakHourLocal}' if temporal.peakHourLocal else 'Peak time unavailable',
                ],
            )

            enriched.append(decision.model_copy(update={
                'temporalEvidence': temporal,
                'confidenceScore': confidence,
                'confidenceLevel': level,
                'confidenceFactors': factors,
                'rationale': rationale,
                'trace': [*decision.trace[:1], temporal_trace, *decision.trace[1:]],
                'evidenceWarnings': evidence_warnings,
            }))

        return base.model_copy(update={
            'providerRequestCount': base.providerRequestCount + profile.providerRequestCount,
            'historicalProfileStatus': profile.dataStatus,
            'historicalProfileDate': profile.date,
            'workers': enriched,
            'warnings': list(dict.fromkeys([
                *base.warnings,
                *([profile.message] if profile.message and profile.dataStatus != 'verified' else []),
            ])),
        })
