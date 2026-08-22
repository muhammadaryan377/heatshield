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
    allowedTasks: list[str] = Field(default_factory=list)
    operationalApproved: bool = True


class SiteZoneCreate(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    type: Literal['open-yard', 'roof', 'staging', 'other'] = 'other'
    center: Coordinate
    allowedTasks: list[str] = Field(default_factory=list, max_length=30)
    operationalApproved: bool = True

    @field_validator('allowedTasks')
    @classmethod
    def clean_tasks(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            task = item.strip()
            if task and task.casefold() not in {entry.casefold() for entry in cleaned}:
                cleaned.append(task[:120])
        return cleaned


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
    granularityMeters: int = 100

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
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


class FortyGuardProfileRequest(CamelModel):
    date: str | None = None
    thresholdC: float = Field(default=30.0, ge=-30.0, le=70.0)
    granularityMeters: int = 100

    @model_validator(mode='after')
    def validate_granularity(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        return self


class FortyGuardLayerStatus(CamelModel):
    analyticType: Literal['tcm', 'time_of_measure', 'exceedance', 'persistence']
    status: Literal['verified', 'unavailable']
    activityId: str | None = None
    cellCount: int = 0
    units: str | None = None
    minValue: float | None = None
    maxValue: float | None = None
    meanValue: float | None = None
    message: str | None = None


class FortyGuardWorkerExposure(CamelModel):
    workerId: str
    workerName: str
    role: str
    area: str
    evidenceStatus: Literal['complete', 'partial', 'unmatched']
    peakTemperatureC: float | None = None
    peakHourUtc: int | None = None
    peakHourLocal: str | None = None
    hoursAboveThreshold: float | None = None
    persistenceHours: float | None = None
    thresholdC: float


class FortyGuardDailyProfile(CamelModel):
    siteId: str
    siteName: str
    date: str
    timezoneName: str
    thresholdC: float
    granularityMeters: int
    dataStatus: Literal['verified', 'partial', 'unavailable', 'configuration_required']
    generatedAt: str
    providerRequestCount: int = 0
    tcmCellCount: int = 0
    minTemperatureC: float | None = None
    meanTemperatureC: float | None = None
    maxTemperatureC: float | None = None
    peakHourUtc: int | None = None
    peakHourLocal: str | None = None
    meanHoursAboveThreshold: float | None = None
    maxHoursAboveThreshold: float | None = None
    meanPersistenceHours: float | None = None
    maxPersistenceHours: float | None = None
    layers: list[FortyGuardLayerStatus] = Field(default_factory=list)
    workers: list[FortyGuardWorkerExposure] = Field(default_factory=list)
    message: str | None = None
    cached: bool = False


class OperationalPlannerRequest(CamelModel):
    offsetsHours: list[int] = Field(default_factory=lambda: [1, 3, 6, 9, 12])
    granularityMeters: int = 100
    minImprovementC: float = Field(default=1.0, ge=0.1, le=10.0)

    @model_validator(mode='after')
    def validate_planner(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        unique = sorted(set(self.offsetsHours))
        if not unique or len(unique) > 5 or any(hour < 1 or hour > 12 for hour in unique):
            raise ValueError('Choose between one and five future offsets from 1 to 12 hours.')
        self.offsetsHours = unique
        return self


class OperationalPlannerOption(CamelModel):
    kind: Literal['now', 'better_time', 'better_place']
    status: Literal['verified', 'unavailable', 'not_applicable']
    label: str
    temperatureC: float | None = None
    deltaC: float | None = None
    sampledAt: str | None = None
    zoneId: str | None = None
    zoneName: str | None = None
    detail: str
    provider: Literal['fortyguard'] = 'fortyguard'


class WorkerOperationalDecision(CamelModel):
    workerId: str
    workerName: str
    role: str
    task: str
    currentArea: str
    workload: str | None = None
    sunExposure: str | None = None
    heatIndexC: float | None = None
    now: OperationalPlannerOption
    betterTime: OperationalPlannerOption
    betterPlace: OperationalPlannerOption
    recommendedChoice: Literal['now', 'better_time', 'better_place', 'review']
    recommendation: str
    rationale: str
    evidenceWarnings: list[str] = Field(default_factory=list)


class OperationalHeatPlan(CamelModel):
    site: Site
    generatedAt: str
    timezoneName: str
    agentMode: Literal['deterministic', 'deepseek_assisted'] = 'deterministic'
    conditionSource: Literal['fortyguard', 'nws'] | None = None
    conditionHeatIndexC: float | None = None
    providerRequestCount: int = 0
    offsetsHours: list[int] = Field(default_factory=list)
    approvedZoneCount: int = 0
    workers: list[WorkerOperationalDecision] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class OperationalApprovalRequest(CamelModel):
    workerId: str
    choice: Literal['now', 'better_time', 'better_place']
    targetTime: str | None = None
    targetZoneId: str | None = None
    baselineTemperatureC: float | None = None
    expectedTemperatureC: float | None = None
    expectedReductionC: float | None = None


class OperationalApproval(CamelModel):
    id: str
    siteId: str
    workerId: str
    choice: Literal['now', 'better_time', 'better_place']
    targetTime: str | None = None
    targetZoneId: str | None = None
    baselineTemperatureC: float | None = None
    expectedTemperatureC: float | None = None
    expectedReductionC: float | None = None
    status: Literal['pending_verification', 'verified', 'verification_unavailable']
    createdAt: str
    verifiedAt: str | None = None
    verifiedTemperatureC: float | None = None
    actualReductionC: float | None = None
    verificationMessage: str | None = None


class ActionAccepted(CamelModel):
    accepted: bool
    message: str
