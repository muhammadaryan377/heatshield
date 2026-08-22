from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


RiskLevel = Literal['low', 'medium', 'high', 'extreme']


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
    risk: RiskLevel = 'low'
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
    level: RiskLevel
    summary: str
    detail: str
    peakWindowStart: str | None = None
    peakWindowEnd: str | None = None


class ForecastPoint(CamelModel):
    time: str
    temperatureC: float


class HeatSpot(CamelModel):
    id: str
    level: RiskLevel
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
    conditionSource: Literal['fortyguard', 'nws'] | None = None
    conditionSourceLabel: str | None = None
    thermalStatus: Literal['verified', 'recent_verified', 'unavailable', 'not_configured'] = 'unavailable'
    thermalObservedAt: str | None = None
    thermalMessage: str | None = None
    fallbackActive: bool = False
    conditions: Conditions | None = None
    deltas: Deltas | None = None
    risk: Risk | None = None
    workers: list[Worker] = Field(default_factory=list)
    highExposureCount: int = 0
    forecast: list[ForecastPoint] = Field(default_factory=list)
    hotspots: list[HeatSpot] = Field(default_factory=list)
    nextAction: NextAction | None = None


class PlanWorkerAction(CamelModel):
    workerId: str
    workerName: str
    role: str
    area: str
    riskLevel: RiskLevel
    currentIssue: str
    recommendedAction: str
    timeWindow: str
    rationale: str


class PlanTimelineItem(CamelModel):
    time: str
    title: str
    detail: str
    category: Literal['hydration', 'work_planning', 'rotation', 'recovery', 'assessment', 'closeout']


class PlanSiteAction(CamelModel):
    id: str
    title: str
    detail: str
    priority: Literal['now', 'today', 'monitor']


class PlanInputs(CamelModel):
    conditionSource: Literal['fortyguard', 'nws'] | None = None
    thermalStatus: str
    observedAt: str | None = None
    temperatureC: float | None = None
    humidityPercent: float | None = None
    heatIndexC: float | None = None
    windKph: float | None = None
    workerCount: int
    highExposureWorkers: int
    directSunWorkers: int
    heavyWorkWorkers: int
    limitedShadeWorkers: int


class OperationalPlan(CamelModel):
    site: Site
    generatedAt: str
    planStatus: Literal['ready', 'limited_data', 'no_workers']
    agentMode: Literal['deterministic', 'deepseek_assisted'] = 'deterministic'
    overallRisk: RiskLevel
    riskHeadline: str
    riskSummary: str
    inputs: PlanInputs
    workers: list[PlanWorkerAction] = Field(default_factory=list)
    timeline: list[PlanTimelineItem] = Field(default_factory=list)
    siteActions: list[PlanSiteAction] = Field(default_factory=list)
    reasoning: str
    reasoningFactors: list[str] = Field(default_factory=list)


class ThermalMapRequest(CamelModel):
    mode: Literal['site', 'custom'] = 'site'
    polygon: list[Coordinate] | None = None
    granularityMeters: int = Field(default=100, ge=50, le=500)

    @model_validator(mode='after')
    def validate_custom_polygon(self):
        if self.mode == 'custom' and (self.polygon is None or len(self.polygon) < 3):
            raise ValueError('A custom thermal area needs at least three map points.')
        if self.polygon is not None and len(self.polygon) > 60:
            raise ValueError('A thermal area can contain at most 60 map points.')
        return self


class ThermalTile(CamelModel):
    id: str
    temperatureC: float
    polygon: list[Coordinate]


class ThermalMapResponse(CamelModel):
    siteId: str
    mode: Literal['site', 'custom']
    dataStatus: Literal['verified', 'unavailable', 'configuration_required']
    observedAt: str | None = None
    timezoneName: str | None = None
    granularityMeters: int
    tileCount: int = 0
    minTemperatureC: float | None = None
    maxTemperatureC: float | None = None
    meanTemperatureC: float | None = None
    hottestTileId: str | None = None
    coolestTileId: str | None = None
    tiles: list[ThermalTile] = Field(default_factory=list)
    message: str | None = None
    cached: bool = False


class ActionAccepted(CamelModel):
    accepted: bool
    message: str
