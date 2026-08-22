from typing import Literal

from pydantic import BaseModel, ConfigDict


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='ignore')


class Coordinate(CamelModel):
    lat: float
    lng: float


class SiteZone(CamelModel):
    id: str
    name: str
    type: Literal['open-yard', 'roof', 'staging', 'other']
    center: Coordinate


class Site(CamelModel):
    id: str
    name: str
    address: str
    center: Coordinate
    polygon: list[Coordinate]
    zones: list[SiteZone]
    status: Literal['active', 'inactive']


class Worker(CamelModel):
    id: str
    name: str
    initials: str
    role: str
    location: str
    locationId: str
    status: Literal['active', 'break', 'offsite']
    risk: Literal['low', 'medium', 'high', 'extreme']
    lastCheckIn: str
    coordinate: Coordinate


class Conditions(CamelModel):
    temperatureC: float
    humidityPercent: float
    heatIndexC: float
    feelsLikeC: float
    windKph: float
    windDirection: str
    weatherLabel: str


class Deltas(CamelModel):
    temperatureC: float
    humidityPercent: float
    heatIndexC: float
    comparedAt: str


class Risk(CamelModel):
    level: Literal['low', 'medium', 'high', 'extreme']
    summary: str
    detail: str
    peakWindowStart: str
    peakWindowEnd: str


class ForecastPoint(CamelModel):
    time: str
    temperatureC: float


class HeatSpot(CamelModel):
    id: str
    level: Literal['low', 'medium', 'high', 'extreme']
    x: float
    y: float
    radius: float


class NextAction(CamelModel):
    title: str
    detail: str
    actionLabel: str
    dueInMinutes: int


class SiteIntelligence(CamelModel):
    site: Site
    observedAt: str
    isLive: bool
    conditions: Conditions
    deltas: Deltas
    risk: Risk
    workers: list[Worker]
    highExposureCount: int
    forecast: list[ForecastPoint]
    hotspots: list[HeatSpot]
    nextAction: NextAction


class ActionAccepted(CamelModel):
    accepted: bool
    message: str
