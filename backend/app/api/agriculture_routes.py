from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.agriculture_schemas import (
    AgricultureField,
    AgricultureFieldCreate,
    AgricultureFieldHeatProfile,
    AgricultureFieldHeatRequest,
)
from app.core.config import Settings, get_settings
from app.services.agriculture_field_heat import AgricultureFieldHeatService
from app.services.agriculture_fields import AgricultureFieldStore


router = APIRouter(prefix='/api')


def field_store(settings: Settings = Depends(get_settings)) -> AgricultureFieldStore:
    return AgricultureFieldStore(settings)


def field_heat_service(settings: Settings = Depends(get_settings)) -> AgricultureFieldHeatService:
    return AgricultureFieldHeatService(settings)


@router.get('/sites/{site_id}/fields', response_model=list[AgricultureField])
async def list_fields(
    site_id: str,
    db: AgricultureFieldStore = Depends(field_store),
) -> list[AgricultureField]:
    try:
        return db.list_fields(site_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Farm not found')


@router.post('/sites/{site_id}/fields', response_model=AgricultureField, status_code=status.HTTP_201_CREATED)
async def create_field(
    site_id: str,
    payload: AgricultureFieldCreate,
    db: AgricultureFieldStore = Depends(field_store),
) -> AgricultureField:
    try:
        return db.create_field(site_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Farm not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.delete('/sites/{site_id}/fields/{field_id}', status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    site_id: str,
    field_id: str,
    db: AgricultureFieldStore = Depends(field_store),
) -> Response:
    try:
        db.delete_field(site_id, field_id)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Farm or field not found')
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    '/sites/{site_id}/fields/{field_id}/fortyguard-profile',
    response_model=AgricultureFieldHeatProfile,
)
async def field_heat_profile(
    site_id: str,
    field_id: str,
    payload: AgricultureFieldHeatRequest,
    svc: AgricultureFieldHeatService = Depends(field_heat_service),
) -> AgricultureFieldHeatProfile:
    try:
        return await svc.generate(site_id, field_id, payload)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Farm or field not found')
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
