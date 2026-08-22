from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.schemas import ActionAccepted, SiteIntelligence
from app.services.fortyguard import FortyGuardConfigurationError
from app.services.site_intelligence import SiteIntelligenceService

router = APIRouter(prefix='/api')


def service(settings: Settings = Depends(get_settings)) -> SiteIntelligenceService:
    return SiteIntelligenceService(settings)


@router.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@router.get('/sites/{site_id}/intelligence', response_model=SiteIntelligence)
async def site_intelligence(site_id: str, svc: SiteIntelligenceService = Depends(service)) -> SiteIntelligence:
    try:
        return await svc.get(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except FortyGuardConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


@router.post('/sites/{site_id}/actions/hydration-reminder', response_model=ActionAccepted)
async def hydration_reminder(site_id: str, settings: Settings = Depends(get_settings)) -> ActionAccepted:
    try:
        load = load_site_fixture_for_action(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')

    if settings.heatshield_use_fixtures:
        return ActionAccepted(accepted=True, message=f"Hydration reminder queued for {load.site.name} in development mode")

    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail='Notification delivery provider is not configured yet.',
    )


def load_site_fixture_for_action(site_id: str) -> SiteIntelligence:
    from app.services.fixtures import load_site_fixture
    return load_site_fixture(site_id)
