from fastapi import APIRouter, Depends, HTTPException, status

from app.agentic_models import AgenticHeatPlan
from app.core.config import Settings, get_settings
from app.schemas import OperationalPlannerRequest
from app.services.agentic_temporal_core import TemporalAgenticDecisionCoreService


router = APIRouter(prefix='/api')


def agentic_service(settings: Settings = Depends(get_settings)) -> TemporalAgenticDecisionCoreService:
    return TemporalAgenticDecisionCoreService(settings)


@router.post('/sites/{site_id}/agent/run', response_model=AgenticHeatPlan)
async def run_agentic_decision(
    site_id: str,
    payload: OperationalPlannerRequest,
    svc: TemporalAgenticDecisionCoreService = Depends(agentic_service),
) -> AgenticHeatPlan:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
