from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.advanced_models import (
    FortyGuardAdvancedSnapshot,
    FortyGuardAdvancedSnapshotRequest,
    FortyGuardHeatIntelligenceRequest,
    FortyGuardHeatIntelligenceStatus,
    FortyGuardHeatIntelligenceSubmission,
    FortyGuardUsageSummary,
)
from app.core.config import Settings, get_settings
from app.services.fortyguard import FortyGuardAPIError, FortyGuardConfigurationError
from app.services.fortyguard_advanced import FortyGuardAdvancedService


router = APIRouter(prefix='/api')


def advanced_service(settings: Settings = Depends(get_settings)) -> FortyGuardAdvancedService:
    return FortyGuardAdvancedService(settings)


@router.post('/sites/{site_id}/fortyguard/advanced-snapshot', response_model=FortyGuardAdvancedSnapshot)
async def advanced_snapshot(
    site_id: str,
    payload: FortyGuardAdvancedSnapshotRequest,
    svc: FortyGuardAdvancedService = Depends(advanced_service),
) -> FortyGuardAdvancedSnapshot:
    try:
        return await svc.snapshot(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except FortyGuardConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except FortyGuardAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.post(
    '/sites/{site_id}/fortyguard/heat-intelligence',
    response_model=FortyGuardHeatIntelligenceSubmission,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_heat_intelligence(
    site_id: str,
    payload: FortyGuardHeatIntelligenceRequest,
    svc: FortyGuardAdvancedService = Depends(advanced_service),
) -> FortyGuardHeatIntelligenceSubmission:
    try:
        return await svc.submit_heat_intelligence(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except FortyGuardConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except FortyGuardAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.get('/fortyguard/heat-intelligence/{activity_id}/status', response_model=FortyGuardHeatIntelligenceStatus)
async def heat_intelligence_status(
    activity_id: str,
    svc: FortyGuardAdvancedService = Depends(advanced_service),
) -> FortyGuardHeatIntelligenceStatus:
    try:
        result, _ = await svc.heat_intelligence_status(activity_id)
        return result
    except FortyGuardConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except FortyGuardAPIError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get('/fortyguard/heat-intelligence/{activity_id}/download')
async def download_heat_intelligence(
    activity_id: str,
    svc: FortyGuardAdvancedService = Depends(advanced_service),
) -> Response:
    try:
        content, media_type = await svc.download_heat_intelligence(activity_id)
    except FortyGuardConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except FortyGuardAPIError as exc:
        code = status.HTTP_409_CONFLICT if 'not ready' in str(exc).casefold() else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=code, detail=str(exc))
    return Response(
        content=content,
        media_type=media_type,
        headers={
            'Content-Disposition': f'attachment; filename="fortyguard-heat-intelligence-{activity_id[:12]}.pdf"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    )


@router.get('/fortyguard/usage', response_model=FortyGuardUsageSummary)
async def fortyguard_usage(
    svc: FortyGuardAdvancedService = Depends(advanced_service),
) -> FortyGuardUsageSummary:
    return await svc.usage()
