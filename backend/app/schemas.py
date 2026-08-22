from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='ignore')


class Coordinate(CamelModel):
    lat: float
    lng: float


class SiteZone(CamelModel):
    id: str
    name: str
    type: Literal['open-yard', 'roof', 'staging', 'other'] = 'other'
    center: Coordinate


class Site(CamelModel):
    id: str
    name: str
    address: str
    center: Coordinate
    polygon: list[Coordinate]
    zones: list[SiteZone] = Field(default_factory=list)
    status: Literal['active', 'inactive'] = 'active'


class SiteCreate(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=2, max_length=220)
    center: Coordinate
    polygon: list[Coordinate]
    zones: list[SiteZone] = Field(default_factory=list)

    @field_validator('polygon')
    @classmethod
    def validate_polygon(cls, value: list[Coordinate]) -> list[Coordinate]:
        if len(value) < 3:
            raise ValueError('A site boundary needs at least three map points.')
        return value


class Worker(CamelModel):
    id: str
    siteId: str
    workerCode: str | None = None
    name: str
    initials: str
    role: str
    team: str | None = None
    location: str
    locationId: str
    status: Literal['active', 'break', 'offsite'] = 'active'
    risk: Literal['low', 'medium', 'high', 'extreme'] = 'low'
    lastCheckIn: str
    coordinate: Coordinate
    task: str | None = None
    workIntensity: Literal['light', 'moderate', 'heavy'] | None = None
    shiftStart: str | None = None
    shiftEnd: str | None = None
    sunExposure: Literal['indoor', 'partial', 'direct'] | None = None
    shadeAccess: Literal['available', 'limited', 'none'] | None = None
    waterAccess: bool | None = None
    supervisor: str | None = None
    notes: str | None = None


class WorkerCreate(CamelModel):
    workerCode: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    role: str = Field(min_length=2, max_length=120)
    team: str | None = Field(default=None, max_length=120)
    location: str = Field(default='Site area', max_length=120)
    locationId: str = Field(default='site-area', max_length=120)
    coordinate: Coordinate
    task: str | None = Field(default=None, max_length=180)
    workIntensity: Literal['light', 'moderate', 'heavy'] | None = None
    shiftStart: str | None = None
    shiftEnd: str | None = None
    sunExposure: Literal['indoor', 'partial', 'direct'] | None = None
    shadeAccess: Literal['available', 'limited', 'none'] | None = None
    waterAccess: bool | None = None
    supervisor: str | None = Field(default=None, max_length=120)
    status: Literal['active', 'break', 'offsite'] = 'active'
    notes: str | None = Field(default=None, max_length=500)


class Conditions(CamelModel):
    temperatureC: float
    humidityPercent: float
    heatIndexC: float
    feelsLikeC: float
    windKph: float | None = None
    windDirection: str | None = None
    weatherLabel: str | None = None


class Deltas(CamelModel):
    temperatureC: float | None = None
    humidityPercent: float | None = None
    heatIndexC: float | None = None
    comparedAt: str | None = None


class Risk(CamelModel):
    level: Literal['low', 'medium', 'high', 'extreme']
    summary: str
    detail: str
    peakWindowStart: str | None = None
    peakWindowEnd: str | None = None


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
    observedAt: str | None = None
    isLive: bool = False
    dataStatus: Literal['live', 'configuration_required', 'provider_unavailable']
    statusMessage: str | None = None
    conditions: Conditions | None = None
    deltas: Deltas | None = None
    risk: Risk | None = None
    workers: list[Worker] = Field(default_factory=list)
    highExposureCount: int = 0
    forecast: list[ForecastPoint] = Field(default_factory=list)
    hotspots: list[HeatSpot] = Field(default_factory=list)
    nextAction: NextAction | None = None


class ActionAccepted(CamelModel):
    accepted: bool
    message: str
