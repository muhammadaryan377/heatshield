from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx

from app.agentic_models import (
    AgentCritique,
    AgentExecutionStep,
    AgentOption,
    AgentTraceStep,
    AgentWorkerDecision,
    AgenticHeatPlan,
)
from app.core.config import Settings
from app.schemas import OperationalPlannerOption, OperationalPlannerRequest, Worker
from app.services.fortyguard import FortyGuardConfigurationError
from app.services.operational_heat_planner import OperationalHeatPlannerService


class AgenticDecisionCoreService:
    """Evidence-bound operational agent with explicit human approval and verification gates.

    The agent owns orchestration and decision comparison, but it never lets the LLM
    invent measurements, approve actions, or override operational constraints.
    DeepSeek acts as a bounded critic of an already evidence-grounded proposal.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.planner = OperationalHeatPlannerService(settings)
        self.store = self.planner.store

    @staticmethod
    def _option_score(option: OperationalPlannerOption, eligible: bool) -> tuple[int, float | None]:
        if not eligible or option.status != 'verified' or option.temperatureC is None:
            return 0, None
        improvement = None if option.deltaC is None else max(0.0, -option.deltaC)
        if option.kind == 'now':
            return 50, improvement
        return min(100, 50 + round((improvement or 0.0) * 12)), improvement

    @staticmethod
    def _confidence(
        *,
        worker: Worker,
        baseline_verified: bool,
        chosen_verified: bool,
        heat_index_available: bool,
        evidence_freshness: str,
        warnings: list[str],
    ) -> tuple[int, str, list[str]]:
        score = 0
        factors: list[str] = []
        if baseline_verified:
            score += 30
            factors.append('Worker coordinate matched verified FortyGuard surface evidence (+30).')
        if chosen_verified:
            score += 25
            factors.append('Recommended option has a verified spatial sample (+25).')
        if heat_index_available:
            score += 10
            factors.append('Atmospheric heat-index context is available (+10).')
        if worker.task and worker.task.strip():
            score += 10
            factors.append('Worker task is explicitly configured (+10).')
        if worker.workIntensity:
            score += 5
            factors.append('Work-intensity context is configured (+5).')
        if worker.sunExposure:
            score += 5
            factors.append('Sun-exposure context is configured (+5).')
        if worker.shadeAccess is not None:
            score += 5
            factors.append('Shade-access context is configured (+5).')
        if worker.waterAccess is not None:
            score += 5
            factors.append('Water-access context is configured (+5).')
        if evidence_freshness == 'recent_completed_hour':
            score -= 10
            factors.append('Baseline uses the most recent completed-hour evidence rather than the current hour (-10).')
        if warnings:
            penalty = min(20, len(warnings) * 5)
            score -= penalty
            factors.append(f'{len(warnings)} evidence warning(s) reduce confidence (-{penalty}).')
        score = max(0, min(100, score))
        level = 'high' if score >= 80 else 'medium' if score >= 55 else 'low'
        return score, level, factors

    async def _critic(self, site_name: str, decisions: list[AgentWorkerDecision]) -> dict[str, AgentCritique]:
        if not self.settings.deepseek_configured or not decisions:
            return {}

        workers = []
        for decision in decisions:
            workers.append({
                'workerId': decision.workerId,
                'role': decision.role,
                'task': decision.task,
                'workload': decision.workload,
                'sunExposure': decision.sunExposure,
                'shadeAccess': decision.shadeAccess,
                'waterAccess': decision.waterAccess,
                'heatIndexC': decision.heatIndexC,
                'evidenceFreshness': decision.evidenceFreshness,
                'recommendedChoice': decision.recommendedChoice,
                'recommendation': decision.recommendation,
                'confidenceScore': decision.confidenceScore,
                'candidates': [candidate.model_dump(mode='json') for candidate in decision.candidates],
                'warnings': decision.evidenceWarnings,
            })

        system = (
            'You are the bounded safety critic inside HeatShield. The deterministic evidence engine already proposed an action. '
            'You must NOT change temperatures, locations, times, candidate eligibility, or recommendedChoice. '
            'Review only whether the proposal has missing operational context or evidence caveats a supervisor should see. '
            'Return strict JSON: {"workers": {"<workerId>": {"supportsRecommendation": boolean, "assessment": string, '
            '"riskFlags": [string], "missingContext": [string], "supervisorQuestion": string|null}}}. '
            'Use only supplied facts. Never invent regulations, medical claims, sensor values, or weather measurements.'
        )

        try:
            async with httpx.AsyncClient(timeout=self.settings.deepseek_timeout_seconds) as client:
                response = await client.post(
                    f"{self.settings.deepseek_base_url.rstrip('/')}/chat/completions",
                    headers={
                        'Authorization': f'Bearer {self.settings.deepseek_api_key}',
                        'Content-Type': 'application/json',
                    },
                    json={
                        'model': self.settings.deepseek_model,
                        'temperature': 0.0,
                        'response_format': {'type': 'json_object'},
                        'messages': [
                            {'role': 'system', 'content': system},
                            {'role': 'user', 'content': json.dumps({'site': site_name, 'workers': workers})},
                        ],
                    },
                )
                response.raise_for_status()
                payload = response.json()
                parsed = json.loads(payload['choices'][0]['message']['content'])
        except Exception:
            return {}

        raw_workers = parsed.get('workers') if isinstance(parsed, dict) else None
        if not isinstance(raw_workers, dict):
            return {}

        output: dict[str, AgentCritique] = {}
        valid_ids = {decision.workerId for decision in decisions}
        for worker_id, value in raw_workers.items():
            if worker_id not in valid_ids or not isinstance(value, dict):
                continue
            assessment = value.get('assessment')
            if not isinstance(assessment, str) or not assessment.strip():
                continue
            risk_flags = value.get('riskFlags') if isinstance(value.get('riskFlags'), list) else []
            missing = value.get('missingContext') if isinstance(value.get('missingContext'), list) else []
            question = value.get('supervisorQuestion')
            output[worker_id] = AgentCritique(
                source='deepseek',
                supportsRecommendation=bool(value.get('supportsRecommendation', True)),
                assessment=assessment[:700],
                riskFlags=[str(item)[:220] for item in risk_flags[:6]],
                missingContext=[str(item)[:220] for item in missing[:6]],
                supervisorQuestion=str(question)[:300] if isinstance(question, str) and question.strip() else None,
            )
        return output

    async def generate(self, site_id: str, request: OperationalPlannerRequest) -> AgenticHeatPlan:
        site = self.store.get_site(site_id)
        active_workers = [worker for worker in self.store.list_workers(site_id) if worker.status == 'active']
        approved_zones = [zone for zone in site.zones if zone.operationalApproved]
        timezone_name, site_timezone = self.planner.fortyguard._site_timezone(site)
        now_utc = datetime.now(timezone.utc)
        local_now = now_utc.astimezone(site_timezone).replace(minute=0, second=0, microsecond=0)
        warnings: list[str] = []
        provider_request_count = 0

        try:
            _ = self.planner.fortyguard.headers
            configured = True
        except FortyGuardConfigurationError:
            configured = False
            warnings.append('FortyGuard is not configured; the agent cannot verify thermal options.')

        current_target = local_now
        current_features: list[dict] = []
        current_error: str | None = 'FortyGuard not configured'
        freshness = 'unavailable'

        if configured:
            features, error, submitted = await self.planner._scan(site, local_now, request.granularityMeters)
            provider_request_count += 1 if submitted else 0
            current_features, current_error = features, error
            if current_features:
                freshness = 'current_hour'
            else:
                # FortyGuard current-hour tiles can lag. Use only a clearly labelled recent completed hour.
                for hours_back in (1, 2):
                    fallback_target = local_now - timedelta(hours=hours_back)
                    features, error, submitted = await self.planner._scan(site, fallback_target, request.granularityMeters)
                    provider_request_count += 1 if submitted else 0
                    if features:
                        current_target = fallback_target
                        current_features = features
                        current_error = error
                        freshness = 'recent_completed_hour'
                        warnings.append(
                            f'Current-hour spatial tiles were unavailable; agent baseline uses recent completed-hour evidence from {fallback_target.strftime("%b %d, %I:%M %p")}.'
                        )
                        break

        scans: dict[int, tuple[datetime, list[dict], str | None]] = {}
        if configured:
            async def run_offset(offset: int):
                target = local_now + timedelta(hours=offset)
                features, error, submitted = await self.planner._scan(site, target, request.granularityMeters)
                return offset, target, features, error, submitted

            future_results = await asyncio.gather(*(run_offset(offset) for offset in request.offsetsHours))
            for offset, target, features, error, submitted in future_results:
                provider_request_count += 1 if submitted else 0
                scans[offset] = (target, features, error)
                if error:
                    warnings.append(f'Future evidence {target.strftime("%b %d, %I:%M %p")}: {error}')
        else:
            for offset in request.offsetsHours:
                scans[offset] = (local_now + timedelta(hours=offset), [], 'FortyGuard not configured')

        heat_index = None
        condition_source = None
        if configured and current_features:
            heat_index, condition_source, environment_jobs, environment_warning = await self.planner._condition_context(
                site, current_features, current_target
            )
            provider_request_count += environment_jobs
            if environment_warning:
                warnings.append(environment_warning)

        decisions: list[AgentWorkerDecision] = []
        for worker in active_workers:
            task_name = (worker.task or worker.role).strip()
            current_temp = self.planner._sample(current_features, worker.coordinate.lat, worker.coordinate.lng)
            baseline_verified = current_temp is not None
            if baseline_verified:
                now_option = self.planner._verified_option(
                    'now',
                    'CURRENT ASSIGNMENT',
                    current_temp,
                    current_temp,
                    current_target,
                    'Worker coordinate matched a verified FortyGuard thermal cell. '
                    + ('Current-hour evidence.' if freshness == 'current_hour' else 'Recent completed-hour evidence; not presented as live.'),
                )
            else:
                now_option = self.planner._unavailable(
                    'now', 'CURRENT ASSIGNMENT', current_error or 'No verified FortyGuard cell contains the worker coordinate.'
                )

            future_candidates: list[OperationalPlannerOption] = []
            for offset in request.offsetsHours:
                target, features, _ = scans[offset]
                if not self.planner._inside_shift(worker, target):
                    continue
                sampled = self.planner._sample(features, worker.coordinate.lat, worker.coordinate.lng)
                if sampled is None:
                    continue
                future_candidates.append(self.planner._verified_option(
                    'better_time', f'+{offset}h', sampled, current_temp, target,
                    f'Same worker coordinate sampled {offset} hour(s) ahead and kept inside the configured shift.'
                ))

            if future_candidates:
                best_future = min(future_candidates, key=lambda item: item.temperatureC if item.temperatureC is not None else float('inf'))
                improvement = None if current_temp is None or best_future.temperatureC is None else current_temp - best_future.temperatureC
                if improvement is not None and improvement >= request.minImprovementC:
                    better_time = best_future
                else:
                    better_time = OperationalPlannerOption(
                        kind='better_time', status='not_applicable', label='BETTER TIME',
                        temperatureC=best_future.temperatureC, deltaC=best_future.deltaC, sampledAt=best_future.sampledAt,
                        detail=f'Best in-shift future sample does not improve exposure by the configured {request.minImprovementC:.1f}°C threshold.'
                    )
            else:
                better_time = self.planner._unavailable('better_time', 'BETTER TIME', 'No usable in-shift future FortyGuard sample was returned.')

            eligible_zones = [
                zone for zone in approved_zones
                if self.planner._zone_allows_task(zone, worker) and zone.id != worker.locationId
            ]
            zone_candidates: list[OperationalPlannerOption] = []
            for zone in eligible_zones:
                sampled = self.planner._sample(current_features, zone.center.lat, zone.center.lng)
                if sampled is None:
                    continue
                zone_candidates.append(self.planner._verified_option(
                    'better_place', zone.name, sampled, current_temp, current_target,
                    f'Zone is supervisor-approved, task-compatible for {task_name}, and matched to a verified FortyGuard cell.', zone,
                ))

            if zone_candidates:
                best_zone = min(zone_candidates, key=lambda item: item.temperatureC if item.temperatureC is not None else float('inf'))
                improvement = None if current_temp is None or best_zone.temperatureC is None else current_temp - best_zone.temperatureC
                if improvement is not None and improvement >= request.minImprovementC:
                    better_place = best_zone
                else:
                    better_place = OperationalPlannerOption(
                        kind='better_place', status='not_applicable', label='BETTER PLACE',
                        temperatureC=best_zone.temperatureC, deltaC=best_zone.deltaC,
                        zoneId=best_zone.zoneId, zoneName=best_zone.zoneName, sampledAt=best_zone.sampledAt,
                        detail=f'Approved task-compatible zones do not improve exposure by the configured {request.minImprovementC:.1f}°C threshold.'
                    )
            elif not eligible_zones:
                better_place = OperationalPlannerOption(
                    kind='better_place', status='not_applicable', label='BETTER PLACE',
                    detail='No other supervisor-approved zone explicitly allows this task.'
                )
            else:
                better_place = self.planner._unavailable(
                    'better_place', 'BETTER PLACE', 'Eligible approved zones exist, but no verified baseline cell matched their centers.'
                )

            agent_candidates: list[AgentOption] = []
            for option, eligible, notes in (
                (now_option, baseline_verified, ['Requires supervisor approval before operational use.']),
                (better_time, better_time.status == 'verified', ['Must remain inside the configured worker shift.']),
                (better_place, better_place.status == 'verified', ['Only supervisor-approved, task-compatible zones are eligible.']),
            ):
                score, verified_improvement = self._option_score(option, eligible)
                agent_candidates.append(AgentOption(
                    option=option,
                    suitabilityScore=score,
                    verifiedImprovementC=verified_improvement,
                    eligible=eligible,
                    constraintNotes=notes,
                ))

            verified_improvements = [
                candidate for candidate in agent_candidates
                if candidate.eligible
                and candidate.option.kind != 'now'
                and (candidate.verifiedImprovementC or 0) >= request.minImprovementC
            ]

            evidence_warnings: list[str] = []
            if not baseline_verified:
                evidence_warnings.append('Worker baseline is not spatially verified.')
            if freshness == 'recent_completed_hour':
                evidence_warnings.append('Baseline is recent completed-hour evidence, not current-hour evidence.')
            if heat_index is None:
                evidence_warnings.append('Heat-index context is unavailable.')
            if better_time.status == 'unavailable':
                evidence_warnings.append('Future FortyGuard comparison is incomplete.')
            if not approved_zones:
                evidence_warnings.append('No approved zones are configured for Better Place comparison.')

            if not baseline_verified:
                choice = 'review'
                recommendation = 'Manual review required before changing this worker assignment.'
                rationale = 'The agent will not rank operational alternatives without a verified worker-coordinate baseline.'
                chosen_verified = False
            elif verified_improvements:
                chosen = max(verified_improvements, key=lambda candidate: (candidate.verifiedImprovementC or 0, candidate.suitabilityScore))
                choice = chosen.option.kind
                improvement = chosen.verifiedImprovementC or 0
                chosen_verified = True
                if choice == 'better_time':
                    recommendation = f'Propose moving this task to {datetime.fromisoformat(chosen.option.sampledAt).strftime("%I:%M %p")}.' if chosen.option.sampledAt else 'Propose the verified cooler time window.'
                    rationale = f'This preserves the worker location and shift constraints while reducing the verified sampled temperature by about {improvement:.1f}°C.'
                else:
                    recommendation = f'Propose relocating equivalent work to {chosen.option.zoneName}.'
                    rationale = f'This zone is approved for the task and lowers the verified sampled temperature by about {improvement:.1f}°C.'
            else:
                choice = 'now'
                recommendation = 'Keep the current assignment as the provisional option and maintain supervisor heat controls.'
                rationale = 'No verified in-shift time or approved task-compatible zone met the configured minimum thermal improvement.'
                chosen_verified = baseline_verified

            confidence_score, confidence_level, confidence_factors = self._confidence(
                worker=worker,
                baseline_verified=baseline_verified,
                chosen_verified=chosen_verified,
                heat_index_available=heat_index is not None,
                evidence_freshness=freshness,
                warnings=evidence_warnings,
            )

            trace = [
                AgentTraceStep(
                    stage='observe',
                    status='complete' if baseline_verified else 'blocked',
                    title='Observe verified exposure',
                    detail='Match the active worker coordinate to FortyGuard surface evidence and load atmospheric context.',
                    evidence=[
                        f'Baseline: {now_option.temperatureC:.1f}°C' if now_option.temperatureC is not None else 'Baseline cell unavailable',
                        f'Evidence freshness: {freshness.replace("_", " ")}',
                        f'Heat index: {heat_index:.1f}°C' if heat_index is not None else 'Heat index unavailable',
                    ],
                ),
                AgentTraceStep(
                    stage='generate', status='complete', title='Generate candidate actions',
                    detail='Construct Current Assignment, Better Time, and Better Place candidates without inventing locations or temperatures.',
                    evidence=[f'{len(future_candidates)} verified in-shift future candidate(s)', f'{len(zone_candidates)} verified approved-zone candidate(s)'],
                ),
                AgentTraceStep(
                    stage='constrain', status='complete', title='Apply operational constraints',
                    detail='Reject future windows outside the worker shift and reject zones that are not approved or task-compatible.',
                    evidence=[f'Task: {task_name}', f'Shift: {worker.shiftStart or "not configured"} – {worker.shiftEnd or "not configured"}', f'Approved compatible zones: {len(eligible_zones)}'],
                ),
                AgentTraceStep(
                    stage='compare', status='complete' if baseline_verified else 'blocked', title='Compare verified alternatives',
                    detail=f'Rank eligible alternatives by verified thermal improvement using a minimum improvement gate of {request.minImprovementC:.1f}°C.',
                    evidence=[f'{candidate.option.kind}: score {candidate.suitabilityScore}/100' for candidate in agent_candidates],
                ),
                AgentTraceStep(
                    stage='propose', status='warning' if choice == 'review' else 'complete', title='Propose supervisor-gated action',
                    detail=recommendation,
                    evidence=[f'Confidence: {confidence_score}/100 ({confidence_level})', 'Human approval required: yes'],
                ),
            ]

            decisions.append(AgentWorkerDecision(
                workerId=worker.id,
                workerName=worker.name,
                role=worker.role,
                task=task_name,
                currentArea=worker.location,
                workload=worker.workIntensity,
                sunExposure=worker.sunExposure,
                shadeAccess=worker.shadeAccess,
                waterAccess=worker.waterAccess,
                heatIndexC=heat_index,
                evidenceFreshness=freshness,
                baselineObservedAt=current_target.isoformat() if baseline_verified else None,
                candidates=agent_candidates,
                recommendedChoice=choice,
                recommendation=recommendation,
                rationale=rationale,
                confidenceScore=confidence_score,
                confidenceLevel=confidence_level,
                confidenceFactors=confidence_factors,
                humanApprovalRequired=True,
                trace=trace,
                critique=AgentCritique(
                    source='deterministic',
                    supportsRecommendation=True,
                    assessment='Evidence and operational constraints were checked deterministically. AI critic was unavailable or not configured.',
                    missingContext=[item for item in [
                        None if worker.workIntensity else 'Work intensity is not configured.',
                        None if worker.sunExposure else 'Sun exposure is not configured.',
                        None if worker.shadeAccess else 'Shade access is not configured.',
                        None if worker.waterAccess is not None else 'Water access is not configured.',
                    ] if item],
                ),
                evidenceWarnings=evidence_warnings,
            ))

        critiques = await self._critic(site.name, decisions)
        bounded_ai = bool(critiques)
        if critiques:
            revised: list[AgentWorkerDecision] = []
            for decision in decisions:
                critique = critiques.get(decision.workerId, decision.critique)
                trace = list(decision.trace)
                trace.insert(-1, AgentTraceStep(
                    stage='critique',
                    status='complete' if critique.supportsRecommendation else 'warning',
                    title='Bounded AI critic review',
                    detail=critique.assessment,
                    evidence=[*critique.riskFlags, *critique.missingContext][:6] or ['No additional critique flags.'],
                ))
                confidence = decision.confidenceScore
                factors = list(decision.confidenceFactors)
                warnings_for_worker = list(decision.evidenceWarnings)
                if not critique.supportsRecommendation:
                    confidence = max(0, confidence - 10)
                    factors.append('AI critic raised a supervisor review concern (-10).')
                    warnings_for_worker.append('Bounded AI critic does not fully support the proposal; supervisor review is required.')
                level = 'high' if confidence >= 80 else 'medium' if confidence >= 55 else 'low'
                revised.append(decision.model_copy(update={
                    'critique': critique,
                    'trace': trace,
                    'confidenceScore': confidence,
                    'confidenceLevel': level,
                    'confidenceFactors': factors,
                    'evidenceWarnings': warnings_for_worker,
                }))
            decisions = revised

        matched_workers = sum(1 for decision in decisions if decision.evidenceFreshness != 'unavailable')
        coverage = round(matched_workers / len(active_workers) * 100) if active_workers else 0
        if not active_workers:
            warnings.append('No active workers are available for the agent decision loop.')

        return AgenticHeatPlan(
            site=site,
            generatedAt=now_utc.isoformat(),
            timezoneName=timezone_name,
            agentMode='bounded_ai' if bounded_ai else 'deterministic_agent',
            autonomyLevel='supervisor_gated',
            mission='Minimize verified worker thermal exposure while preserving shift, task, location-approval, and evidence-integrity constraints.',
            conditionSource=condition_source,
            conditionHeatIndexC=heat_index,
            providerRequestCount=provider_request_count,
            activeWorkerCount=len(active_workers),
            approvedZoneCount=len(approved_zones),
            evidenceCoveragePercent=coverage,
            workers=decisions,
            executionLoop=[
                AgentExecutionStep(order=1, name='Observe', status='completed', detail='Collect FortyGuard spatial evidence and worker operational context.'),
                AgentExecutionStep(order=2, name='Reason', status='completed', detail='Generate candidates, apply constraints, compare verified thermal outcomes, and run bounded critique.'),
                AgentExecutionStep(order=3, name='Approve', status='current', detail='Supervisor approval is required before HeatShield treats a proposal as an operational decision.'),
                AgentExecutionStep(order=4, name='Verify', status='pending', detail='After approval/target time, run fresh FortyGuard evidence to compare the observed result with the locked baseline.'),
            ],
            warnings=list(dict.fromkeys(warnings)),
        )
