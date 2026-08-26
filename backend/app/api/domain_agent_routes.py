from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.domain_agent_models import DomainAgentPlan, DomainAgentRequest
from app.services.domain_mission_agent import DomainMissionAgentService


router = APIRouter(prefix='/api')


def domain_agent_service(settings: Settings = Depends(get_settings)) -> DomainMissionAgentService:
    return DomainMissionAgentService(settings)


@router.post('/sites/{site_id}/domain-agent', response_model=DomainAgentPlan)
async def run_domain_agent(
    site_id: str,
    payload: DomainAgentRequest,
    svc: DomainMissionAgentService = Depends(domain_agent_service),
) -> DomainAgentPlan:
    try:
        return await svc.generate(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site or required domain context not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
