from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel


ProviderStatus = Literal['verified', 'partial', 'unavailable', 'configuration_required', 'premium_required']


class EnvironmentalContextRequest(CamelModel):
    forceRefresh: bool = False


class EnvironmentalContextResponse(CamelModel):
    siteId: str
    dataStatus: ProviderStatus
    observedAt: str | None = None
    timezoneName: str | None = None
    activityId: str | None = None
    heatmapActivityId: str | None = None
    temperatureC: float | None = None
    heatIndexC: float | None = None
    apparentTemperatureC: float | None = None
    wetBulbTemperatureC: float | None = None
    relativeHumidityPercent: float | None = None
    precipitationMm: float | None = None
    cloudCoverMetric: float | None = None
    aqiUs: float | None = None
    aqiPm25: float | None = None
    aqiPm10: float | None = None
    aqiNo2: float | None = None
    aqiCo: float | None = None
    aqiO3: float | None = None
    aqiSo2: float | None = None
    methanePpb: float | None = None
    co2Ppm: float | None = None
    solarGhi: float | None = None
    solarDni: float | None = None
    solarDhi: float | None = None
    solarDescription: str | None = None
    temperatureStdDevC: float | None = None
    overallTemperatureDistribution: list[float] = Field(default_factory=list)
    normalTemperatureDistribution: dict[str, Any] = Field(default_factory=dict)
    temperatureFrequency: dict[str, Any] = Field(default_factory=dict)
    message: str | None = None
    cached: bool = False


class SitePhysicalContextRequest(CamelModel):
    granularityMeters: int = 80
    includeSatellite: bool = True
    includeStreetView: bool = True
    streetHorizontalAngle: float = Field(default=0.0, ge=0.0, le=360.0)
    streetVerticalAngle: float = Field(default=0.0, ge=-90.0, le=90.0)
    streetBackView: bool = False

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        if not self.includeSatellite and not self.includeStreetView:
            raise ValueError('Choose at least one physical-context source.')
        return self


class SegmentationView(CamelModel):
    status: ProviderStatus
    activityId: str | None = None
    imageDataUrl: str | None = None
    segmentedImageDataUrl: str | None = None
    imageDate: str | None = None
    imageYear: int | None = None
    segments: dict[str, float] = Field(default_factory=dict)
    legend: dict[str, Any] = Field(default_factory=dict)
    processingTimeSeconds: float | None = None
    message: str | None = None


class SitePhysicalContextResponse(CamelModel):
    siteId: str
    dataStatus: ProviderStatus
    generatedAt: str
    observationTime: str | None = None
    satellite: SegmentationView | None = None
    streetFront: SegmentationView | None = None
    streetBack: SegmentationView | None = None
    message: str | None = None


class HeatIntelligenceRequest(CamelModel):
    analysis: list[Literal['geographic', 'environmental', 'urban', 'events', 'anthropogenic']] = Field(
        default_factory=lambda: ['geographic', 'environmental', 'urban', 'events', 'anthropogenic']
    )

    @model_validator(mode='after')
    def validate_analysis(self):
        unique: list[str] = []
        for item in self.analysis:
            if item not in unique:
                unique.append(item)
        if not unique:
            raise ValueError('Choose at least one Heat Intelligence analysis category.')
        self.analysis = unique  # type: ignore[assignment]
        return self


class HeatIntelligenceResponse(CamelModel):
    siteId: str
    dataStatus: ProviderStatus
    activityId: str | None = None
    reportId: str | None = None
    downloadPath: str | None = None
    observedAt: str | None = None
    analysis: list[str] = Field(default_factory=list)
    message: str | None = None


class FortyGuardUsageResponse(CamelModel):
    dataStatus: Literal['verified', 'unavailable', 'configuration_required']
    fetchedAt: str
    plan: str | None = None
    creditsUsed: float | None = None
    creditsRemaining: float | None = None
    creditsLimit: float | None = None
    creditsResetDate: str | None = None
    activityBreakdown: dict[str, Any] = Field(default_factory=dict)
    message: str | None = None
