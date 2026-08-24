from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas import CamelModel, Coordinate


AssetType = Literal[
    'transformer',
    'hvac',
    'chiller',
    'generator',
    'cooling_tower',
    'ups',
    'server_room',
    'loading_area',
    'other',
]
AssetCriticality = Literal['low', 'medium', 'high', 'critical']
AssetStatus = Literal['operational', 'maintenance', 'offline']


class EnterpriseAsset(CamelModel):
    id: str
    siteId: str
    assetCode: str
    name: str
    type: AssetType
    coordinate: Coordinate
    criticality: AssetCriticality
    status: AssetStatus = 'operational'
    heatLimitC: float | None = None
    coolingDependent: bool = False
    owner: str | None = None
    notes: str | None = None
    createdAt: str


class EnterpriseAssetCreate(CamelModel):
    assetCode: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    type: AssetType = 'other'
    coordinate: Coordinate
    criticality: AssetCriticality = 'medium'
    status: AssetStatus = 'operational'
    heatLimitC: float | None = Field(default=None, ge=-30.0, le=100.0)
    coolingDependent: bool = False
    owner: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=500)
