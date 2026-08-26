from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx

from app.core.config import Settings
from app.domain_agent_models import (
    DomainAgentCandidate,
    DomainAgentCritique,
    DomainAgentDecision,
    DomainAgentEvidence,
    DomainAgentPlan,
    DomainAgentRequest,
    DomainAgentTraceStep,
)
from app.schemas import Coordinate, FortyGuardProfileRequest, OperationalPlannerRequest, ThermalMapRequest, ThermalMapResponse
from app.services.agentic_decision_core import AgenticDecisionCoreService
from app.services.agriculture_fields import AgricultureFieldStore
from app.services.enterprise_assets import EnterpriseAssetStore
from app.services.fortyguard_profile import FortyGuardProfileService
from app.services.store import HeatShieldStore
from app.services.thermal_map import ThermalMapService
from app.services.urban_interventions import UrbanInterventionService


class DomainMissionAgentService:
    """Run one bounded HeatShield mission agent across four domain toolkits.

    The service never asks the LLM to discover measurements or choose arbitrary
    operational actions. Provider evidence and domain constraints produce the
    candidate set first. DeepSeek, when configured, is only a bounded critic of
    the already-derived proposal.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.thermal = ThermalMapService(settings)
        self.profile = FortyGuardProfileService(settings)
        self.assets = EnterpriseAssetStore(settings)
        self.fields = AgricultureFieldStore(settings)
        self.interventions = UrbanInterventionService(settings)
        self.workforce_agent = AgenticDecisionCoreService(settings)

    @staticmethod
    def _point_on_segment(point: Coordinate, a: Coordinate, b: Coordinate, epsilon: float = 1e-9) -> bool:
        cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng)
        if abs(cross) > epsilon:
            return False
        return (
            min(a.lng, b.lng) - epsilon <= point.lng <= max(a.lng, b.lng) + epsilon
            and min(a.lat, b.lat) - epsilon <= point.lat <= max(a.lat, b.lat) + epsilon
        )

    @classmethod
    def _point_in_polygon(cls, point: Coordinate, polygon: list[Coordinate]) -> bool:
        if len(polygon) < 3:
            return False
        for index, current in enumerate(polygon):
            if cls._point_on_segment(point, polygon[index - 1], current):
                return True
        inside = False
        j = len(polygon) - 1
        for i, current in enumerate(polygon):
            previous = polygon[j]
            denominator = previous.lat - current.lat
            if ((current.lat > point.lat) != (previous.lat > point.lat)) and abs(denominator) > 1e-12:
                crossing_lng = (
                    (previous.lng - current.lng) * (point.lat - current.lat) / denominator + current.lng
                )
                if point.lng < crossing_lng:
                    inside = not inside
            j = i
        return inside

    @classmethod
    def _sample_thermal(cls, thermal: ThermalMapResponse, point: Coordinate) -> float | None:
        if thermal.dataStatus != 'verified':
            return None
        for tile in thermal.tiles:
            if cls._point_in_polygon(point, tile.polygon):
                return tile.temperatureC
        return None

    @staticmethod
    def _confidence_level(score: int) -> str:
        if score >= 80:
            return 'high'
        if score >= 55:
            return 'medium'
        return 'low'

    @staticmethod
    def _coverage(statuses: list[bool]) -> int:
        if not statuses:
            return 0
        return round(sum(1 for item in statuses if item) / len(statuses) * 100)

    async def _bounded_critic(
        self,
        *,
        module: str,
        site_name: str,
        action: str,
        rationale: str,
        evidence: list[DomainAgentEvidence],
        candidates: list[DomainAgentCandidate],
        deterministic_missing: list[str],
        deterministic_flags: list[str],
    ) -> DomainAgentCritique:
        deterministic = DomainAgentCritique(
            source='deterministic',
            supportsRecommendation=True,
            assessment='The proposal follows the available HeatShield evidence and domain constraints; human review remains required before operational action.',
            riskFlags=deterministic_flags,
            missingContext=deterministic_missing,
        )
        if not self.settings.deepseek_configured:
            return deterministic

        compact = {
            'module': module,
            'site': site_name,
            'proposedAction': action,
            'rationale': rationale,
            'evidence': [item.model_dump(mode='json') for item in evidence],
            'candidates': [item.model_dump(mode='json') for item in candidates[:6]],
        }
        system = (
            'You are HeatShield bounded decision critic. Provider values, candidate scores, eligibility, routes, and the proposed action '
            'were produced by deterministic code. Do not invent measurements, change scores, choose a new action, or claim causation. '
            'Return JSON with supportsRecommendation (boolean), assessment (string), riskFlags (array of short strings), and '
            'missingContext (array of short strings). Focus on whether a human reviewer needs more context before accepting the proposal.'
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
                        'temperature': 0.1,
                        'response_format': {'type': 'json_object'},
                        'messages': [
                            {'role': 'system', 'content': system},
                            {'role': 'user', 'content': json.dumps(compact)},
                        ],
                    },
                )
                response.raise_for_status()
                payload = response.json()
                parsed = json.loads(payload['choices'][0]['message']['content'])
            if not isinstance(parsed, dict):
                return deterministic
            return DomainAgentCritique(
                source='deepseek',
                supportsRecommendation=bool(parsed.get('supportsRecommendation', True)),
                assessment=str(parsed.get('assessment') or deterministic.assessment)[:900],
                riskFlags=[str(item)[:180] for item in parsed.get('riskFlags', []) if isinstance(item, str)][:8],
                missingContext=[str(item)[:180] for item in parsed.get('missingContext', []) if isinstance(item, str)][:8],
            )
        except Exception:
            return deterministic

    async def generate(self, site_id: str, request: DomainAgentRequest) -> DomainAgentPlan:
        if request.module == 'workforce':
            return await self._workforce(site_id, request)
        if request.module == 'enterprise':
            return await self._enterprise(site_id, request)
        if request.module == 'agriculture':
            return await self._agriculture(site_id, request)
        return await self._urban(site_id, request)

    async def _workforce(self, site_id: str, request: DomainAgentRequest) -> DomainAgentPlan:
        plan = await self.workforce_agent.generate(
            site_id,
            OperationalPlannerRequest(
                offsetsHours=[1, 3, 6, 9, 12],
                granularityMeters=request.granularityMeters,
                minImprovementC=1.0,
            ),
        )
        site = plan.site
        candidates: list[DomainAgentCandidate] = []
        for worker in plan.workers:
            selected = next(
                (item for item in worker.candidates if item.option.kind == worker.recommendedChoice),
                None,
            )
            candidates.append(DomainAgentCandidate(
                id=worker.workerId,
                label=worker.workerName,
                entityType='worker',
                priorityScore=worker.confidenceScore,
                eligible=worker.recommendedChoice != 'review',
                temperatureC=selected.option.temperatureC if selected else None,
                deltaC=selected.option.deltaC if selected else None,
                metricLabel='Decision confidence',
                metricValue=f'{worker.confidenceScore}/100',
                rationale=worker.rationale,
                constraints=['Supervisor approval required before an operational assignment changes.'],
                nextRoute=f'/plan?site={site.id}',
            ))

        selected_worker = next(
            (worker for worker in plan.workers if worker.recommendedChoice in {'better_time', 'better_place'}),
            next((worker for worker in plan.workers if worker.recommendedChoice == 'review'), plan.workers[0] if plan.workers else None),
        )
        if selected_worker:
            action = selected_worker.recommendation
            rationale = selected_worker.rationale
            critique = DomainAgentCritique(
                source=selected_worker.critique.source,
                supportsRecommendation=selected_worker.critique.supportsRecommendation,
                assessment=selected_worker.critique.assessment,
                riskFlags=selected_worker.critique.riskFlags,
                missingContext=selected_worker.critique.missingContext,
            )
            confidence = selected_worker.confidenceScore
            candidate_id = selected_worker.workerId
        else:
            action = 'Add active workers with task and map context before running the worker decision loop.'
            rationale = 'The workforce agent cannot produce a worker-level assignment decision without an active worker context.'
            critique = DomainAgentCritique(
                source='deterministic',
                assessment='Worker setup is required before operational decisions can be evaluated.',
                missingContext=['Active worker task and location context'],
            )
            confidence = 20
            candidate_id = None

        evidence = [
            DomainAgentEvidence(
                id='workforce-evidence',
                label='Worker decision evidence',
                source='FortyGuard + HeatShield worker context',
                status='verified' if plan.evidenceCoveragePercent >= 80 else 'partial' if plan.evidenceCoveragePercent else 'unavailable',
                detail=f'{plan.evidenceCoveragePercent}% worker evidence coverage across {plan.activeWorkerCount} active workers.',
            ),
        ]
        return DomainAgentPlan(
            module='workforce',
            site=site,
            audience='Site safety & operations supervisor',
            mission='Choose the safest practical worker time/place from verified heat evidence, then approve and verify the result.',
            generatedAt=plan.generatedAt,
            agentMode=plan.agentMode,
            evidenceCoveragePercent=plan.evidenceCoveragePercent,
            providerRequestCount=plan.providerRequestCount,
            evidence=evidence,
            candidates=candidates,
            decision=DomainAgentDecision(
                recommendedCandidateId=candidate_id,
                action=action,
                rationale=rationale,
                confidenceScore=confidence,
                confidenceLevel=self._confidence_level(confidence),
                nextRoute=f'/plan?site={site.id}',
                critique=critique,
            ),
            trace=[
                DomainAgentTraceStep(order=1, stage='observe', status='complete' if plan.evidenceCoveragePercent else 'warning', title='Observe worker exposure', detail=f'{plan.activeWorkerCount} active workers evaluated with {plan.evidenceCoveragePercent}% evidence coverage.'),
                DomainAgentTraceStep(order=2, stage='rank', status='complete' if candidates else 'blocked', title='Compare time and place', detail='The worker agent compares current assignment, in-shift future windows and supervisor-approved zones.'),
                DomainAgentTraceStep(order=3, stage='constrain', status='complete', title='Apply operational constraints', detail='Offsite/break workers, out-of-shift times and non-approved zones cannot become actions.'),
                DomainAgentTraceStep(order=4, stage='propose', status='complete' if selected_worker else 'blocked', title='Propose supervisor action', detail=action),
                DomainAgentTraceStep(order=5, stage='verify', status='warning', title='Verify after approval', detail='Fresh FortyGuard evidence is requested after the supervisor records an action.'),
            ],
            warnings=plan.warnings,
        )

    async def _enterprise(self, site_id: str, request: DomainAgentRequest) -> DomainAgentPlan:
        site = self.store.get_site(site_id)
        assets = self.assets.list_assets(site_id)
        thermal = await self.thermal.generate(site_id, ThermalMapRequest(mode='site', granularityMeters=request.granularityMeters))
        thermal_ready = thermal.dataStatus == 'verified' and thermal.meanTemperatureC is not None
        candidates: list[DomainAgentCandidate] = []
        criticality_weight = {'low': 10, 'medium': 25, 'high': 40, 'critical': 55}
        matched = 0
        limit_configured = 0

        for asset in assets:
            temperature = self._sample_thermal(thermal, asset.coordinate) if thermal_ready else None
            if temperature is not None:
                matched += 1
            if asset.heatLimitC is not None:
                limit_configured += 1
            lift = temperature - thermal.meanTemperatureC if temperature is not None and thermal.meanTemperatureC is not None else None
            limit_exceedance = temperature - asset.heatLimitC if temperature is not None and asset.heatLimitC is not None else None
            score = criticality_weight[asset.criticality]
            if asset.coolingDependent:
                score += 10
            if lift is not None and lift > 0:
                score += min(20, round(lift / 4 * 20))
            if limit_exceedance is not None and limit_exceedance > 0:
                score += min(25, round(limit_exceedance / 5 * 25))
            score = min(100, score)
            constraints = []
            if asset.heatLimitC is None:
                constraints.append('No engineering heat limit is configured; this remains a prioritization screen, not a failure diagnosis.')
            if asset.status != 'operational':
                constraints.append(f'Asset status is {asset.status}; operational context must be reviewed before action.')
            candidates.append(DomainAgentCandidate(
                id=asset.id,
                label=asset.name,
                entityType='enterprise_asset',
                priorityScore=score,
                eligible=temperature is not None,
                temperatureC=temperature,
                deltaC=lift,
                metricLabel='Business criticality',
                metricValue=asset.criticality,
                rationale=(
                    f'{asset.name} is {asset.criticality}-critical{", cooling-dependent" if asset.coolingDependent else ""}. '
                    + (f'Its matched FortyGuard cell is {temperature:.1f}°C' if temperature is not None else 'No verified thermal cell currently matches its coordinate')
                    + (f', {lift:+.1f}°C versus the site mean.' if lift is not None else '.')
                ),
                constraints=constraints,
                nextRoute=f'/enterprise/assets?site={site.id}',
            ))
        candidates.sort(key=lambda item: item.priorityScore, reverse=True)

        if not assets:
            action = 'Register critical operational assets before asking HeatShield to prioritize enterprise heat exposure.'
            rationale = 'Property heat evidence can identify hotspots, but an enterprise decision needs real asset coordinates and criticality.'
            next_route = f'/enterprise/assets?site={site.id}'
            candidate_id = None
        elif not thermal_ready:
            action = 'Review property exposure evidence before making an asset-priority decision.'
            rationale = thermal.message or 'No verified FortyGuard spatial layer is available for asset-to-cell matching.'
            next_route = f'/enterprise/property-exposure?site={site.id}'
            candidate_id = None
        else:
            top = next((item for item in candidates if item.eligible), None)
            if top is None:
                action = 'Review asset coordinates because registered assets could not be matched to verified thermal cells.'
                rationale = 'HeatShield will not infer asset temperature from a site mean when the coordinate has no matching provider cell.'
                next_route = f'/enterprise/assets?site={site.id}'
                candidate_id = None
            else:
                candidate_id = top.id
                next_route = f'/enterprise/industrial?site={site.id}' if top.priorityScore >= 60 else f'/enterprise/assets?site={site.id}'
                action = (
                    f'Prioritize an engineering heat-exposure review for {top.label}.'
                    if top.priorityScore >= 60
                    else f'Review {top.label} as the highest current asset-priority candidate.'
                )
                rationale = f'{top.rationale} HeatShield is prioritizing review, not automatically changing equipment state or load.'

        evidence = [
            DomainAgentEvidence(id='thermal', label='Property thermal surface', source='FortyGuard', status='verified' if thermal_ready else 'unavailable', detail=thermal.message or f'{thermal.tileCount} verified cells.'),
            DomainAgentEvidence(id='assets', label='Asset registry', source='HeatShield Enterprise', status='verified' if assets else 'unavailable', detail=f'{len(assets)} registered assets; {matched} matched to verified thermal cells.'),
            DomainAgentEvidence(id='limits', label='Engineering heat limits', source='Customer asset context', status='context' if limit_configured else 'unavailable', detail=f'{limit_configured}/{len(assets)} assets have a configured heat limit.' if assets else 'No registered assets.'),
        ]
        coverage = self._coverage([thermal_ready, bool(assets), bool(assets) and matched == len(assets)])
        confidence = min(95, max(20, round(35 + coverage * 0.55)))
        missing = []
        flags = []
        if not thermal_ready:
            missing.append('Verified FortyGuard asset-level spatial evidence')
        if not assets:
            missing.append('Registered enterprise assets')
        if assets and limit_configured < len(assets):
            missing.append('Engineering heat limits for some assets')
        if candidates and candidates[0].priorityScore >= 70:
            flags.append('High-priority asset screening signal; engineering review should precede any operating change.')
        critique = await self._bounded_critic(
            module='enterprise', site_name=site.name, action=action, rationale=rationale,
            evidence=evidence, candidates=candidates, deterministic_missing=missing, deterministic_flags=flags,
        )
        return DomainAgentPlan(
            module='enterprise', site=site, audience='Facility, asset & portfolio manager',
            mission='Identify the site or asset needing the next engineering heat review without inventing equipment failure or mitigation impact.',
            generatedAt=datetime.now(timezone.utc).isoformat(),
            agentMode='bounded_ai' if critique.source == 'deepseek' else 'deterministic_agent',
            evidenceCoveragePercent=coverage, providerRequestCount=0, evidence=evidence, candidates=candidates[:8],
            decision=DomainAgentDecision(
                recommendedCandidateId=candidate_id, action=action, rationale=rationale,
                confidenceScore=confidence, confidenceLevel=self._confidence_level(confidence),
                nextRoute=next_route, critique=critique,
            ),
            trace=[
                DomainAgentTraceStep(order=1, stage='observe', status='complete' if thermal_ready else 'warning', title='Observe property heat', detail=thermal.message or 'FortyGuard spatial evidence checked.'),
                DomainAgentTraceStep(order=2, stage='rank', status='complete' if candidates else 'warning', title='Rank asset exposure context', detail=f'{len(candidates)} assets screened by criticality, cooling dependency and matched thermal evidence.'),
                DomainAgentTraceStep(order=3, stage='constrain', status='complete', title='Block unsupported engineering claims', detail='Missing heat limits remain missing; the agent does not infer failure temperature or automatic load changes.'),
                DomainAgentTraceStep(order=4, stage='critique', status='complete', title='Critique proposed review', detail=critique.assessment),
                DomainAgentTraceStep(order=5, stage='propose', status='complete', title='Propose human-reviewed next action', detail=action),
            ],
            warnings=missing,
        )

    async def _agriculture(self, site_id: str, request: DomainAgentRequest) -> DomainAgentPlan:
        site = self.store.get_site(site_id)
        fields = [field for field in self.fields.list_fields(site_id) if field.status == 'active']
        thermal = await self.thermal.generate(site_id, ThermalMapRequest(mode='site', granularityMeters=request.granularityMeters))
        daily = await self.profile.generate(site_id, FortyGuardProfileRequest(thresholdC=request.thresholdC, granularityMeters=request.granularityMeters))
        thermal_ready = thermal.dataStatus == 'verified' and thermal.meanTemperatureC is not None
        daily_ready = daily.dataStatus in {'verified', 'partial'}
        candidates: list[DomainAgentCandidate] = []
        matched = 0
        persistence = daily.maxPersistenceHours or 0

        for field in fields:
            temperature = self._sample_thermal(thermal, field.center) if thermal_ready else None
            if temperature is not None:
                matched += 1
            lift = temperature - thermal.meanTemperatureC if temperature is not None and thermal.meanTemperatureC is not None else None
            threshold_excess = temperature - request.thresholdC if temperature is not None else None
            score = 0
            if threshold_excess is not None and threshold_excess > 0:
                score += min(60, round(threshold_excess / 6 * 60))
            if lift is not None and lift > 0:
                score += min(25, round(lift / 4 * 25))
            if persistence > 0:
                score += min(15, round(persistence / 6 * 15))
            constraints = [
                'Thermal evidence is not a substitute for soil moisture, crop physiology, irrigation flow or agronomy guidance.',
                'The agent can prioritize inspection and work timing; it does not prescribe a water quantity.',
            ]
            candidates.append(DomainAgentCandidate(
                id=field.id,
                label=field.name,
                entityType='agriculture_field',
                priorityScore=min(100, score),
                eligible=temperature is not None,
                temperatureC=temperature,
                deltaC=lift,
                metricLabel='Crop context',
                metricValue=' · '.join(item for item in [field.crop, field.growthStage] if item) or 'Crop metadata not configured',
                rationale=(
                    f'{field.name} has '
                    + (f'a matched FortyGuard center cell at {temperature:.1f}°C' if temperature is not None else 'no matched verified center cell')
                    + (f', {lift:+.1f}°C versus the farm mean.' if lift is not None else '.')
                ),
                constraints=constraints,
                nextRoute=f'/agriculture/field-work?farm={site.id}',
            ))
        candidates.sort(key=lambda item: item.priorityScore, reverse=True)

        if not fields:
            action = 'Create field boundaries before HeatShield prioritizes field work or irrigation inspection.'
            rationale = 'A farm-wide thermal layer cannot identify which operational field needs action without real field geometry.'
            next_route = f'/agriculture/fields?farm={site.id}'
            candidate_id = None
        elif not thermal_ready:
            action = 'Review crop heat evidence availability before issuing a field-operation recommendation.'
            rationale = thermal.message or 'Verified FortyGuard farm cells are unavailable.'
            next_route = f'/agriculture/crop-heat-stress?farm={site.id}'
            candidate_id = None
        else:
            top = next((item for item in candidates if item.eligible), None)
            if top is None:
                action = 'Review field geometry because no active field center matched a verified thermal cell.'
                rationale = 'HeatShield will not substitute the farm mean for a field-level measurement.'
                next_route = f'/agriculture/fields?farm={site.id}'
                candidate_id = None
            else:
                candidate_id = top.id
                severe_duration = (daily.maxHoursAboveThreshold or 0) >= 3 or persistence >= 3
                if top.temperatureC is not None and (top.temperatureC >= request.thresholdC or severe_duration):
                    action = f'Prioritize heat-sensitive work timing and irrigation-system inspection for {top.label}.'
                    rationale = f'{top.rationale} Daily exceedance/persistence context supports operational attention, but HeatShield does not infer soil moisture or prescribe irrigation volume.'
                    next_route = f'/agriculture/field-work?farm={site.id}'
                else:
                    action = f'Keep {top.label} on routine thermal watch and use field-work planning if conditions rise.'
                    rationale = f'{top.rationale} No stronger evidence-backed field action is justified by the available thermal screening.'
                    next_route = f'/agriculture/alerts?farm={site.id}'

        evidence = [
            DomainAgentEvidence(id='thermal', label='Farm thermal surface', source='FortyGuard', status='verified' if thermal_ready else 'unavailable', detail=thermal.message or f'{thermal.tileCount} verified cells.'),
            DomainAgentEvidence(id='fields', label='Field registry', source='HeatShield Agriculture', status='verified' if fields else 'unavailable', detail=f'{len(fields)} active fields; {matched} matched to verified thermal cells.'),
            DomainAgentEvidence(id='daily', label='Daily exceedance & persistence', source='FortyGuard', status='verified' if daily.dataStatus == 'verified' else 'partial' if daily_ready else 'unavailable', detail=daily.message or f'{daily.providerRequestCount} daily profile provider requests.'),
        ]
        coverage = self._coverage([thermal_ready, bool(fields), daily_ready, bool(fields) and matched == len(fields)])
        confidence = min(95, max(20, round(30 + coverage * 0.6)))
        missing = []
        flags = []
        if not thermal_ready:
            missing.append('Verified farm thermal cells')
        if not fields:
            missing.append('Field boundaries')
        if not daily_ready:
            missing.append('Daily exceedance/persistence layers')
        missing.extend(['Soil moisture / irrigation-flow measurements are outside this agent evidence set'])
        if candidates and candidates[0].priorityScore >= 65:
            flags.append('Elevated thermal field screening; confirm crop and field conditions before changing operations.')
        critique = await self._bounded_critic(
            module='agriculture', site_name=site.name, action=action, rationale=rationale,
            evidence=evidence, candidates=candidates, deterministic_missing=missing, deterministic_flags=flags,
        )
        return DomainAgentPlan(
            module='agriculture', site=site, audience='Farm & field operations manager',
            mission='Prioritize field work timing and irrigation inspection from thermal evidence without inventing agronomy or water demand.',
            generatedAt=datetime.now(timezone.utc).isoformat(),
            agentMode='bounded_ai' if critique.source == 'deepseek' else 'deterministic_agent',
            evidenceCoveragePercent=coverage, providerRequestCount=daily.providerRequestCount,
            evidence=evidence, candidates=candidates[:8],
            decision=DomainAgentDecision(
                recommendedCandidateId=candidate_id, action=action, rationale=rationale,
                confidenceScore=confidence, confidenceLevel=self._confidence_level(confidence),
                nextRoute=next_route, critique=critique,
            ),
            trace=[
                DomainAgentTraceStep(order=1, stage='observe', status='complete' if thermal_ready else 'warning', title='Observe farm heat', detail=thermal.message or 'Farm spatial evidence checked.'),
                DomainAgentTraceStep(order=2, stage='rank', status='complete' if candidates else 'warning', title='Rank field thermal attention', detail=f'{len(candidates)} active fields screened against the verified farm layer and daily persistence context.'),
                DomainAgentTraceStep(order=3, stage='constrain', status='complete', title='Apply agronomy guardrails', detail='No soil moisture, crop damage, water demand or irrigation volume is inferred from thermal evidence alone.'),
                DomainAgentTraceStep(order=4, stage='critique', status='complete', title='Critique field recommendation', detail=critique.assessment),
                DomainAgentTraceStep(order=5, stage='propose', status='complete', title='Propose farm-manager next action', detail=action),
            ],
            warnings=missing,
        )

    async def _urban(self, site_id: str, request: DomainAgentRequest) -> DomainAgentPlan:
        site = self.store.get_site(site_id)
        thermal = await self.thermal.generate(site_id, ThermalMapRequest(mode='site', granularityMeters=request.granularityMeters))
        daily = await self.profile.generate(site_id, FortyGuardProfileRequest(thresholdC=request.thresholdC, granularityMeters=request.granularityMeters))
        interventions = self.interventions.list(site_id)
        thermal_ready = thermal.dataStatus == 'verified' and thermal.meanTemperatureC is not None
        daily_ready = daily.dataStatus in {'verified', 'partial'}
        candidates: list[DomainAgentCandidate] = []

        if thermal_ready:
            hottest = sorted(thermal.tiles, key=lambda tile: tile.temperatureC, reverse=True)[:5]
            max_lift = max((tile.temperatureC - thermal.meanTemperatureC for tile in hottest), default=0.0)
            for index, tile in enumerate(hottest):
                lift = tile.temperatureC - thermal.meanTemperatureC
                anomaly_factor = 0 if max_lift <= 0 else max(0.0, lift) / max_lift
                persistence_factor = min(1.0, (daily.maxPersistenceHours or 0) / 6) if daily_ready else 0
                exceedance_factor = min(1.0, (daily.maxHoursAboveThreshold or 0) / 6) if daily_ready else 0
                score = round((anomaly_factor * 0.65 + persistence_factor * 0.20 + exceedance_factor * 0.15) * 100)
                candidates.append(DomainAgentCandidate(
                    id=tile.id,
                    label=f'Hotspot candidate {index + 1}',
                    entityType='urban_hotspot_candidate',
                    priorityScore=score,
                    eligible=True,
                    temperatureC=tile.temperatureC,
                    deltaC=lift,
                    metricLabel='Within-district lift',
                    metricValue=f'{lift:+.1f}°C vs district mean',
                    rationale=f'FortyGuard cell {tile.id} is {tile.temperatureC:.1f}°C, {lift:+.1f}°C relative to the verified district mean.',
                    constraints=['This is an intra-district hotspot candidate, not a formal urban-vs-rural heat-island intensity claim.'],
                    nextRoute=f'/urban/heat-islands?district={site.id}',
                ))

        completed = next((item for item in interventions if item.status == 'completed'), None)
        active_intervention = next((item for item in interventions if item.status in {'approved', 'in_progress', 'proposed'}), None)
        top = candidates[0] if candidates else None
        if completed:
            candidate_id = completed.id
            action = f'Run a matched Before / After verification for completed intervention “{completed.title}”.'
            rationale = 'A completed intervention should be evaluated against its locked FortyGuard baseline before the team claims a cooling outcome.'
            next_route = f'/urban/before-after?district={site.id}&intervention={completed.id}'
        elif active_intervention:
            candidate_id = active_intervention.id
            action = f'Review intervention “{active_intervention.title}” against the current hotspot evidence before changing its status.'
            rationale = 'HeatShield keeps intervention evidence and implementation status separate; the next step is a human review of the active intervention context.'
            next_route = f'/urban/interventions?district={site.id}'
        elif top:
            candidate_id = top.id
            action = 'Investigate the top hotspot candidate with Heat Islands / Urban Analysis before creating an intervention.'
            rationale = f'{top.rationale} A defensible intervention needs reference-area and driver context before HeatShield records an action.'
            next_route = f'/urban/heat-islands?district={site.id}'
        else:
            candidate_id = None
            action = 'Restore verified district evidence before prioritizing an urban intervention.'
            rationale = thermal.message or 'No verified hotspot candidate is available.'
            next_route = f'/urban?district={site.id}'

        evidence = [
            DomainAgentEvidence(id='thermal', label='District thermal surface', source='FortyGuard', status='verified' if thermal_ready else 'unavailable', detail=thermal.message or f'{thermal.tileCount} verified cells.'),
            DomainAgentEvidence(id='daily', label='Daily persistence & exceedance', source='FortyGuard', status='verified' if daily.dataStatus == 'verified' else 'partial' if daily_ready else 'unavailable', detail=daily.message or f'{daily.providerRequestCount} daily profile provider requests.'),
            DomainAgentEvidence(id='interventions', label='Intervention registry', source='HeatShield Urban', status='context' if interventions else 'unavailable', detail=f'{len(interventions)} recorded intervention(s).' if interventions else 'No intervention has been recorded yet.'),
        ]
        coverage = self._coverage([thermal_ready, daily_ready, bool(interventions) or bool(candidates)])
        confidence = min(95, max(20, round(35 + coverage * 0.55)))
        missing = []
        flags = []
        if not thermal_ready:
            missing.append('Verified district thermal cells')
        if not daily_ready:
            missing.append('Daily persistence/exceedance context')
        missing.append('Formal UHI intensity requires a defensible matched reference area')
        if completed:
            flags.append('Completed intervention exists; verify outcome before creating a causal cooling claim.')
        critique = await self._bounded_critic(
            module='urban', site_name=site.name, action=action, rationale=rationale,
            evidence=evidence, candidates=candidates, deterministic_missing=missing, deterministic_flags=flags,
        )
        return DomainAgentPlan(
            module='urban', site=site, audience='Urban planner & resilience team',
            mission='Move from persistent hotspot evidence to a defensible intervention and matched outcome verification without overstating causation.',
            generatedAt=datetime.now(timezone.utc).isoformat(),
            agentMode='bounded_ai' if critique.source == 'deepseek' else 'deterministic_agent',
            evidenceCoveragePercent=coverage, providerRequestCount=daily.providerRequestCount,
            evidence=evidence, candidates=candidates,
            decision=DomainAgentDecision(
                recommendedCandidateId=candidate_id, action=action, rationale=rationale,
                confidenceScore=confidence, confidenceLevel=self._confidence_level(confidence),
                nextRoute=next_route, critique=critique,
            ),
            trace=[
                DomainAgentTraceStep(order=1, stage='observe', status='complete' if thermal_ready else 'warning', title='Observe district heat', detail=thermal.message or 'District spatial evidence checked.'),
                DomainAgentTraceStep(order=2, stage='rank', status='complete' if candidates else 'warning', title='Rank hotspot candidates', detail=f'{len(candidates)} intra-district hotspot candidates ranked from measured thermal lift and available temporal context.'),
                DomainAgentTraceStep(order=3, stage='constrain', status='complete', title='Apply urban-science guardrails', detail='The agent blocks formal UHI and causal intervention claims without the required matched evidence.'),
                DomainAgentTraceStep(order=4, stage='critique', status='complete', title='Critique urban next step', detail=critique.assessment),
                DomainAgentTraceStep(order=5, stage='propose', status='complete' if thermal_ready or completed or active_intervention else 'blocked', title='Propose planner next action', detail=action),
                DomainAgentTraceStep(order=6, stage='verify', status='complete' if completed else 'warning', title='Verify completed interventions', detail='Before / After uses the locked baseline, a post-completion FortyGuard target cell and local-time matching.'),
            ],
            warnings=missing,
        )
