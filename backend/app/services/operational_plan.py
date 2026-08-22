from __future__ import annotations

from datetime import datetime, timezone

from app.core.config import Settings
from app.schemas import (
    OperationalPlan,
    PlanInputs,
    PlanSiteAction,
    PlanTimelineItem,
    PlanWorkerAction,
    RiskLevel,
    Worker,
)
from app.services.site_intelligence import SiteIntelligenceService


RISK_ORDER: dict[RiskLevel, int] = {'low': 0, 'medium': 1, 'high': 2, 'extreme': 3}


def _issue(worker: Worker) -> str:
    parts: list[str] = []
    if worker.sunExposure == 'direct':
        parts.append('direct sun')
    elif worker.sunExposure == 'partial':
        parts.append('intermittent sun')
    elif worker.sunExposure == 'indoor':
        parts.append('indoor heat buildup')
    if worker.workIntensity == 'heavy':
        parts.append('heavy physical work')
    elif worker.workIntensity == 'moderate':
        parts.append('moderate workload')
    if worker.shadeAccess == 'none':
        parts.append('no shade')
    elif worker.shadeAccess == 'limited':
        parts.append('limited shade')
    if worker.waterAccess is False:
        parts.append('water access missing')
    return ' + '.join(parts) if parts else 'routine heat exposure'


def _window(worker: Worker) -> str:
    if worker.shiftStart and worker.shiftEnd:
        return f'{worker.shiftStart}–{worker.shiftEnd}'
    if worker.shiftStart:
        return f'From {worker.shiftStart}'
    return 'Current shift'


def _worker_action(worker: Worker, heat_index: float | None) -> PlanWorkerAction:
    issue = _issue(worker)
    risk = worker.risk
    task = worker.task or worker.role

    if risk == 'extreme':
        if worker.sunExposure == 'direct' or worker.workIntensity == 'heavy':
            action = (
                f'Remove from continuous {task.lower()} exposure now. Use a 30/15 work-recovery rotation, '
                'move recovery to shade, and reassign to a lower-intensity task during the hottest part of the shift.'
            )
        else:
            action = 'Reduce physical intensity immediately, enforce a shaded recovery break, and reassess before resuming the task.'
    elif risk == 'high':
        if worker.sunExposure == 'direct' and worker.workIntensity == 'heavy':
            action = (
                f'Limit {task.lower()} to 45-minute work blocks with 15-minute shaded recovery. '
                'Move the heaviest portion of the task to the coolest available shift window.'
            )
        elif worker.sunExposure == 'direct':
            action = 'Rotate with a lower-exposure worker every 45 minutes and use shaded recovery at each rotation.'
        else:
            action = 'Keep the current assignment but reduce sustained exertion and enforce scheduled hydration and recovery checks.'
    elif risk == 'medium':
        if worker.sunExposure == 'indoor':
            action = 'Continue the indoor assignment with ventilation, hydration at least every 45–60 minutes, and a mid-shift heat check.'
        else:
            action = 'Continue with hourly hydration, avoid unnecessary heavy lifts during hotter periods, and use shade for all breaks.'
    else:
        action = 'Continue the current assignment with routine hydration and normal supervisor check-ins.'

    if worker.waterAccess is False:
        action += ' Do not deploy until drinking water access is confirmed.'
    if worker.shadeAccess == 'none' and risk in ('high', 'extreme'):
        action += ' Supervisor must assign a reachable shaded recovery point before work continues.'

    heat_text = f' at heat index {heat_index:.1f}°C' if heat_index is not None else ''
    rationale = f'{worker.name} is screened {risk.upper()} because of {issue}{heat_text}.'
    return PlanWorkerAction(
        workerId=worker.id,
        workerName=worker.name,
        role=worker.role,
        area=worker.location,
        riskLevel=risk,
        currentIssue=issue,
        recommendedAction=action,
        timeWindow=_window(worker),
        rationale=rationale,
    )


class OperationalPlanService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.intelligence = SiteIntelligenceService(settings)

    async def generate(self, site_id: str) -> OperationalPlan:
        intelligence = await self.intelligence.get(site_id)
        conditions = intelligence.conditions
        heat_index = conditions.heatIndexC if conditions else None
        workers = [worker for worker in intelligence.workers if worker.status != 'offsite']
        worker_actions = [_worker_action(worker, heat_index) for worker in workers]

        overall_risk: RiskLevel = intelligence.risk.level if intelligence.risk else 'low'
        if worker_actions:
            worker_max = max((item.riskLevel for item in worker_actions), key=lambda level: RISK_ORDER[level])
            if RISK_ORDER[worker_max] > RISK_ORDER[overall_risk]:
                overall_risk = worker_max

        high_workers = sum(item.riskLevel in ('high', 'extreme') for item in worker_actions)
        direct_sun = sum(worker.sunExposure == 'direct' for worker in workers)
        heavy_work = sum(worker.workIntensity == 'heavy' for worker in workers)
        limited_shade = sum(worker.shadeAccess in ('limited', 'none') for worker in workers)

        source = intelligence.conditionSourceLabel or 'No live condition source'
        if conditions:
            risk_headline = (
                f'{overall_risk.capitalize()} operational heat risk: '
                f'{high_workers} worker{"s" if high_workers != 1 else ""} require elevated controls.'
            )
            risk_summary = (
                f'{source} reports {conditions.temperatureC:.1f}°C with heat index {conditions.heatIndexC:.1f}°C. '
                f'The plan combines those conditions with each worker’s task intensity, sun, shade and water access.'
            )
        else:
            risk_headline = 'Environmental data is limited; worker controls are based on recorded exposure context.'
            risk_summary = 'No verified current conditions are available. The plan avoids claiming temperature-driven controls or spatial hotspots.'

        timeline: list[PlanTimelineItem] = [
            PlanTimelineItem(time='Shift start', title='Readiness checkpoint', detail='Confirm drinking water, recovery shade and worker assignments before deployment.', category='hydration'),
        ]
        if direct_sun or heavy_work:
            timeline.append(PlanTimelineItem(time='First 60 min', title='Front-load strenuous work', detail='Complete the highest-intensity outdoor tasks early where practical and avoid adding new heavy exposure later.', category='work_planning'))
        if high_workers:
            timeline.append(PlanTimelineItem(time='Every 45 min', title='High-exposure rotation', detail=f'Rotate and visually check the {high_workers} high/extreme-risk worker(s); use shaded recovery before returning to exposure.', category='rotation'))
        timeline.append(PlanTimelineItem(time='Mid-shift', title='Mandatory reassessment', detail='Recheck conditions, hydration, fatigue indicators and task assignments; extend recovery if risk has increased.', category='assessment'))
        timeline.append(PlanTimelineItem(time='Shift close', title='Closeout check', detail='Confirm all workers are accounted for and document any heat-related symptoms, task changes or controls used.', category='closeout'))

        site_actions: list[PlanSiteAction] = []
        if high_workers:
            site_actions.append(PlanSiteAction(id='high-risk', title='Prioritize high-risk workers', detail=f'Supervisors should actively track {high_workers} high/extreme-risk worker(s).', priority='now'))
        if limited_shade:
            site_actions.append(PlanSiteAction(id='shade', title='Secure recovery shade', detail=f'{limited_shade} active worker(s) have limited or no recorded shade access.', priority='now'))
        missing_water = sum(worker.waterAccess is False for worker in workers)
        if missing_water:
            site_actions.append(PlanSiteAction(id='water', title='Resolve water access', detail=f'Do not deploy {missing_water} worker(s) until drinking water access is confirmed.', priority='now'))
        if heavy_work:
            site_actions.append(PlanSiteAction(id='schedule', title='Move heavy work earlier', detail=f'Resequence {heavy_work} heavy-work assignment(s) toward the coolest available shift window.', priority='today'))
        site_actions.append(PlanSiteAction(id='reassess', title='Supervisor reassessment', detail='Review conditions and worker status again at mid-shift before relaxing controls.', priority='monitor'))

        factors: list[str] = []
        if conditions:
            factors.append(f'Heat index {conditions.heatIndexC:.1f}°C')
        if direct_sun:
            factors.append(f'{direct_sun} direct-sun worker(s)')
        if heavy_work:
            factors.append(f'{heavy_work} heavy-work assignment(s)')
        if limited_shade:
            factors.append(f'{limited_shade} limited/no-shade worker(s)')
        if intelligence.fallbackActive:
            factors.append('NWS fallback active')
        if intelligence.thermalStatus == 'unavailable':
            factors.append('FortyGuard thermal layer unavailable')

        if intelligence.fallbackActive:
            reasoning = (
                f'The current atmospheric inputs are verified by {source}. FortyGuard spatial thermal tiles are currently unavailable, '
                'so HeatShield does not infer hotspots or temperature differences across the site. Worker actions are derived from the '
                'verified site conditions plus each saved worker profile.'
            )
        else:
            reasoning = (
                'The plan uses verified FortyGuard conditions together with worker role, current task, physical intensity, sun exposure, '
                'shade access and water access. Higher-exposure workers receive stricter rotations and reassignment controls.'
            )

        if not workers:
            status = 'no_workers'
        elif conditions:
            status = 'ready'
        else:
            status = 'limited_data'

        return OperationalPlan(
            site=intelligence.site,
            generatedAt=datetime.now(timezone.utc).isoformat(),
            planStatus=status,
            overallRisk=overall_risk,
            riskHeadline=risk_headline,
            riskSummary=risk_summary,
            inputs=PlanInputs(
                conditionSource=intelligence.conditionSource,
                thermalStatus=intelligence.thermalStatus,
                observedAt=intelligence.observedAt,
                temperatureC=conditions.temperatureC if conditions else None,
                humidityPercent=conditions.humidityPercent if conditions else None,
                heatIndexC=conditions.heatIndexC if conditions else None,
                windKph=conditions.windKph if conditions else None,
                workerCount=len(workers),
                highExposureWorkers=high_workers,
                directSunWorkers=direct_sun,
                heavyWorkWorkers=heavy_work,
                limitedShadeWorkers=limited_shade,
            ),
            workers=worker_actions,
            timeline=timeline,
            siteActions=site_actions,
            reasoning=reasoning,
            reasoningFactors=factors,
        )
