from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.schemas import OperationalApproval
from app.services.workforce_reports import WorkforceReportStore

router = APIRouter(prefix='/api')


def workforce_report_store(settings: Settings = Depends(get_settings)) -> WorkforceReportStore:
    return WorkforceReportStore(settings)


@router.get('/sites/{site_id}/operational-planner/approvals', response_model=list[OperationalApproval])
async def list_operational_approvals(
    site_id: str,
    db: WorkforceReportStore = Depends(workforce_report_store),
) -> list[OperationalApproval]:
    try:
        return db.list_operational_approvals(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Site not found')
