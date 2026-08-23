from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.config import Settings, get_settings
from app.historical_models import HistoricalHeatBehaviorRequest, HistoricalHeatBehaviorResponse
from app.schemas import (
    ActionAccepted,
    FortyGuardDailyProfile,
    FortyGuardProfileRequest,
    OperationalApproval,
    OperationalApprovalRequest,
    OperationalHeatPlan,
    OperationalPlannerRequest,
    OperationalPlan,
    Site,
    SiteCreate,
    SiteIntelligence,
    SiteUpdate,
    SiteZoneCreate,
    SiteZoneUpdate,
    ThermalMapRequest,
    ThermalMapResponse,
    Worker,
    WorkerCreate,
)
from app.services.fortyguard_profile import FortyGuardProfileService
from app.services.historical_heat_behavior import HistoricalHeatBehaviorService
from app.services.operational_heat_planner import OperationalHeatPlannerService
from app.services.operational_plan import OperationalPlanService
from app.services.site_intelligence import SiteIntelligenceService
from app.services.store import HeatShieldStore
from app.services.thermal_map import ThermalMapService

router = APIRouter(prefix='/api')


def intelligence_service(settings: Settings = Depends(get_settings)) -> SiteIntelligenceService:
    return SiteIntelligenceService(settings)


def plan_service(settings: Settings = Depends(get_settings)) -> OperationalPlanService:
    return OperationalPlanService(settings)


def operational_heat_planner_service(settings: Settings = Depends(get_settings)) -> OperationalHeatPlannerService:
    return OperationalHeatPlannerService(settings)


def thermal_map_service(settings: Settings = Depends(get_settings)) -> ThermalMapService:
    return ThermalMapService(settings)


def fortyguard_profile_service(settings: Settings = Depends(get_settings)) -> FortyGuardProfileService:
    return FortyGuardProfileService(settings)


def historical_heat_behavior_service(settings: Settings = Depends(get_settings)) -> HistoricalHeatBehaviorService:
    return HistoricalHeatBehaviorService(settings)


def store(settings: Settings = Depends(get_settings)) -> HeatShieldStore:
    return HeatShieldStore(settings)


@router.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@router.get('/config/status')
async def config_status(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        'fortyguardConfigured': settings.fortyguard_configured,
        'fortyguardBaseUrl': settings.fortyguard_base_url,
        'nwsFallbackEnabled': True,
        'nwsBaseUrl': settings.nws_base_url,
        'deepseekConfigured': settings.deepseek_configured,
        'fixturesEnabled': settings.heatshield_use_fixtures,
        'environment': settings.app_env,
    }


@router.get('/sites', response_model=list[Site])
async def list_sites(db: HeatShieldStore = Depends(store)) -> list[Site]:
    return db.list_sites()


@router.post('/sites', response_model=Site, status_code=status.HTTP_201_CREATED)
async def create_site(payload: SiteCreate, db: HeatShieldStore = Depends(store)) -> Site:
    return db.create_site(payload)


@router.get('/sites/{site_id}', response_model=Site)
async def get_site(site_id: str, db: HeatShieldStore = Depends(store)) -> Site:
    try:
        return db.get_site(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')


@router.put('/sites/{site_id}', response_model=Site)
async def update_site(site_id: str, payload: SiteUpdate, db: HeatShieldStore = Depends(store)) -> Site:
    try:
        return db.update_site(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.delete('/sites/{site_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(site_id: str, db: HeatShieldStore = Depends(store)) -> Response:
    try:
        db.delete_site(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post('/sites/{site_id}/zones', response_model=Site, status_code=status.HTTP_201_CREATED)
async def add_site_zone(site_id: str, payload: SiteZoneCreate, db: HeatShieldStore = Depends(store)) -> Site:
    try:
        return db.add_zone(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put('/sites/{site_id}/zones/{zone_id}', response_model=Site)
async def update_site_zone(site_id: str, zone_id: str, payload: SiteZoneUpdate, db: HeatShieldStore = Depends(store)) -> Site:
    try:
        return db.update_zone(site_id, zone_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site or zone not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.delete('/sites/{site_id}/zones/{zone_id}', response_model=Site)
async def delete_site_zone(site_id: str, zone_id: str, db: HeatShieldStore = Depends(store)) -> Site:
    try:
        return db.delete_zone(site_id, zone_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site or zone not found')


@router.get('/sites/{site_id}/workers', response_model=list[Worker])
async def list_workers(site_id: str, db: HeatShieldStore = Depends(store)) -> list[Worker]:
    try:
        return db.list_workers(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')


@router.post('/sites/{site_id}/workers', response_model=Worker, status_code=status.HTTP_201_CREATED)
async def create_worker(site_id: str, payload: WorkerCreate, db: HeatShieldStore = Depends(store)) -> Worker:
    try:
        return db.create_worker(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get('/sites/{site_id}/intelligence', response_model=SiteIntelligence)
async def site_intelligence(site_id: str, svc: SiteIntelligenceService = Depends(intelligence_service)) -> SiteIntelligence:
    try:
        return await svc.get(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')


@router.post('/sites/{site_id}/heatmap', response_model=ThermalMapResponse)
async def generate_thermal_map(site_id: str, payload: ThermalMapRequest, svc: ThermalMapService = Depends(thermal_map_service)) -> ThermalMapResponse:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/fortyguard-profile', response_model=FortyGuardDailyProfile)
async def generate_fortyguard_profile(site_id: str, payload: FortyGuardProfileRequest, svc: FortyGuardProfileService = Depends(fortyguard_profile_service)) -> FortyGuardDailyProfile:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/historical-heat-behavior', response_model=HistoricalHeatBehaviorResponse)
async def historical_heat_behavior(site_id: str, payload: HistoricalHeatBehaviorRequest, svc: HistoricalHeatBehaviorService = Depends(historical_heat_behavior_service)) -> HistoricalHeatBehaviorResponse:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/operational-planner', response_model=OperationalHeatPlan)
async def operational_planner(site_id: str, payload: OperationalPlannerRequest, svc: OperationalHeatPlannerService = Depends(operational_heat_planner_service)) -> OperationalHeatPlan:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/operational-planner/approvals', response_model=OperationalApproval, status_code=status.HTTP_201_CREATED)
async def approve_operational_decision(site_id: str, payload: OperationalApprovalRequest, svc: OperationalHeatPlannerService = Depends(operational_heat_planner_service)) -> OperationalApproval:
    try:
        return await svc.approve(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site or worker not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/operational-planner/approvals/{approval_id}/verify', response_model=OperationalApproval)
async def verify_operational_decision(site_id: str, approval_id: str, svc: OperationalHeatPlannerService = Depends(operational_heat_planner_service)) -> OperationalApproval:
    try:
        return await svc.verify(site_id, approval_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site, worker or approval not found')


@router.post('/sites/{site_id}/plan', response_model=OperationalPlan)
async def generate_plan(site_id: str, svc: OperationalPlanService = Depends(plan_service)) -> OperationalPlan:
    try:
        return await svc.generate(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')


@router.post('/sites/{site_id}/actions/hydration-reminder', response_model=ActionAccepted)
async def hydration_reminder(site_id: str, db: HeatShieldStore = Depends(store)) -> ActionAccepted:
    try:
        workers = db.list_workers(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    active = [worker for worker in workers if worker.status == 'active']
    if not active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='No active workers are assigned to this site.')
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail='Worker notification delivery is not configured yet.')
