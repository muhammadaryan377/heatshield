from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel, Coordinate, ThermalMapResponse


class UrbanMorphologyRequest(CamelModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    observedAt: str
    granularityMeters: int = 80
    includeStreetView: bool = True

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        if not self.observedAt.strip():
            raise ValueError('A verified thermal observation timestamp is required for morphology analysis.')
        return self


class UrbanSegmentationLayer(CamelModel):
    kind: Literal['satellite', 'streetview']
    status: Literal['verified', 'unavailable']
    activityId: str | None = None
    imageDate: str | None = None
    imageYear: int | None = None
    segments: dict[str, float] = Field(default_factory=dict)
    originalImageDataUrl: str | None = None
    segmentedImageDataUrl: str | None = None
    message: str | None = None


class UrbanMorphologyResponse(CamelModel):
    siteId: str
    latitude: float
    longitude: float
    observedAt: str
    dataStatus: Literal['verified', 'partial', 'unavailable', 'configuration_required']
    providerRequestCount: int = 0
    satellite: UrbanSegmentationLayer
    streetView: UrbanSegmentationLayer
    coolingCoveragePercent: float | None = None
    heatStoringCoveragePercent: float | None = None
    dominantClasses: list[str] = Field(default_factory=list)
    message: str | None = None


UrbanInterventionType = Literal[
    'tree_canopy',
    'shade_structure',
    'cool_surface',
    'green_surface',
    'cool_roof',
    'other',
]
UrbanInterventionStatus = Literal['proposed', 'approved', 'in_progress', 'completed', 'archived']


class UrbanInterventionEvidence(CamelModel):
    source: Literal['fortyguard'] = 'fortyguard'
    cellId: str
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    cellPolygon: list[Coordinate] = Field(default_factory=list)
    baselineObservedAt: str
    baselineTemperatureC: float
    districtMeanTemperatureC: float
    anomalyC: float
    historicalStartDate: str | None = None
    historicalEndDate: str | None = None
    thresholdF: float | None = None
    persistenceHours: float | None = None
    exceedanceHours: float | None = None
    peakHourLocal: str | None = None
    morphologyStatus: Literal['verified', 'partial', 'unavailable', 'not_requested'] = 'not_requested'
    coolingCoveragePercent: float | None = None
    heatStoringCoveragePercent: float | None = None
    dominantClasses: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_evidence(self):
        if not self.cellId.strip():
            raise ValueError('Intervention evidence requires a selected FortyGuard cell.')
        if not self.baselineObservedAt.strip():
            raise ValueError('Intervention evidence requires a verified baseline timestamp.')
        return self


class UrbanInterventionCreate(CamelModel):
    type: UrbanInterventionType
    title: str = Field(min_length=3, max_length=120)
    owner: str | None = Field(default=None, max_length=120)
    targetDate: str | None = None
    targetAreaM2: float | None = Field(default=None, gt=0)
    rationale: str = Field(min_length=8, max_length=1200)
    mechanism: str = Field(min_length=8, max_length=800)
    measurementPlan: str = Field(min_length=8, max_length=1200)
    evidence: UrbanInterventionEvidence


class UrbanInterventionUpdate(CamelModel):
    status: UrbanInterventionStatus


class UrbanIntervention(CamelModel):
    id: str
    siteId: str
    type: UrbanInterventionType
    title: str
    status: UrbanInterventionStatus
    owner: str | None = None
    targetDate: str | None = None
    targetAreaM2: float | None = None
    rationale: str
    mechanism: str
    measurementPlan: str
    evidence: UrbanInterventionEvidence
    createdAt: str
    updatedAt: str
    completedAt: str | None = None


class UrbanBeforeAfterRequest(CamelModel):
    granularityMeters: int = 80
    localTimeToleranceMinutes: int = Field(default=90, ge=15, le=240)

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        return self


class UrbanBeforeAfterVerification(CamelModel):
    id: str | None = None
    siteId: str
    interventionId: str
    generatedAt: str
    dataStatus: Literal['verified', 'context_only', 'not_ready', 'unavailable', 'configuration_required']
    interpretation: Literal[
        'relative_cooling_signal',
        'relative_warming_signal',
        'no_clear_change',
        'not_comparable',
    ] = 'not_comparable'
    evidenceStrength: Literal['strong', 'limited', 'insufficient'] = 'insufficient'
    baselineObservedAt: str
    baselineTemperatureC: float
    baselineDistrictMeanC: float
    baselineAnomalyC: float
    afterObservedAt: str | None = None
    afterTemperatureC: float | None = None
    afterDistrictMeanC: float | None = None
    afterAnomalyC: float | None = None
    rawTemperatureChangeC: float | None = None
    anomalyChangeC: float | None = None
    localClockDifferenceMinutes: int | None = None
    localTimeToleranceMinutes: int = 90
    timeMatched: bool = False
    afterObservationAfterCompletion: bool = False
    targetCellMatched: bool = False
    completionTimestamp: str | None = None
    afterThermal: ThermalMapResponse | None = None
    message: str
