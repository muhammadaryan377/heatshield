from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.schemas import (
    ActionAccepted,
    FortyGuardDailyProfile,
    FortyGuardProfileRequest,
    OperationalPlan,
    Site,
    SiteCreate,
    SiteIntelligence,
    ThermalMapRequest,
    ThermalMapResponse,
    Worker,
    WorkerCreate,
)
from app.services.fortyguard_profile import FortyGuardProfileService
from app.services.operational_plan import OperationalPlanService
from app.services.site_intelligence import SiteIntelligenceService
from app.services.store import HeatShieldStore
from app.services.thermal_map import ThermalMapService

router = APIRouter(prefix='/api')


def intelligence_service(settings: Settings = Depends(get_settings)) -> SiteIntelligenceService:
    return SiteIntelligenceService(settings)


def plan_service(settings: Settings = Depends(get_settings)) -> OperationalPlanService:
    return OperationalPlanService(settings)


def thermal_map_service(settings: Settings = Depends(get_settings)) -> ThermalMapService:
    return ThermalMapService(settings)


def fortyguard_profile_service(settings: Settings = Depends(get_settings)) -> FortyGuardProfileService:
    return FortyGuardProfileService(settings)


def store(settings: Settings = Depends(get_settings)) -> HeatShieldStore:
    return HeatShieldStore(settings)


@router.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@router.get('/config/status')
async def config_status(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    """Return non-secret configuration state for local/product diagnostics."""
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
async def site_intelligence(
    site_id: str,
    svc: SiteIntelligenceService = Depends(intelligence_service),
) -> SiteIntelligence:
    try:
        return await svc.get(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')


@router.post('/sites/{site_id}/heatmap', response_model=ThermalMapResponse)
async def generate_thermal_map(
    site_id: str,
    payload: ThermalMapRequest,
    svc: ThermalMapService = Depends(thermal_map_service),
) -> ThermalMapResponse:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/fortyguard-profile', response_model=FortyGuardDailyProfile)
async def generate_fortyguard_profile(
    site_id: str,
    payload: FortyGuardProfileRequest,
    svc: FortyGuardProfileService = Depends(fortyguard_profile_service),
) -> FortyGuardDailyProfile:
    """Generate a daily sponsor-data profile without conflating it with live weather."""
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post('/sites/{site_id}/plan', response_model=OperationalPlan)
async def generate_plan(
    site_id: str,
    svc: OperationalPlanService = Depends(plan_service),
) -> OperationalPlan:
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

    # Notification provider is intentionally explicit. We never claim a real
    # message was delivered until a provider is connected.
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail='Worker notification delivery is not configured yet.',
    )
