from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='ignore')


class FortyGuardAdvancedSnapshotRequest(CamelModel):
    date: str | None = None
    time: str | None = None
    granularityMeters: Literal[60, 80, 100] = 100

    @model_validator(mode='after')
    def validate_time_pair(self):
        if self.time and not self.date:
            raise ValueError('Choose a date when specifying a historical analysis time.')
        return self


class FortyGuardSolarIrradiance(CamelModel):
    ghiWm2: float | None = None
    dniWm2: float | None = None
    dhiWm2: float | None = None
    description: str | None = None


class FortyGuardAirQuality(CamelModel):
    aqiUs: float | None = None
    pm25Aqi: float | None = None
    pm10Aqi: float | None = None
    no2Aqi: float | None = None
    coAqi: float | None = None
    o3Aqi: float | None = None
    so2Aqi: float | None = None


class FortyGuardEnvironmentalEvidence(CamelModel):
    heatIndexC: float | None = None
    apparentTemperatureC: float | None = None
    wetBulbTemperatureC: float | None = None
    relativeHumidityPercent: float | None = None
    precipitationMm: float | None = None
    cloudCoverMetric: float | None = None
    methanePpb: float | None = None
    co2Ppm: float | None = None
    elevationM: float | None = None
    airQuality: FortyGuardAirQuality = Field(default_factory=FortyGuardAirQuality)
    solar: FortyGuardSolarIrradiance = Field(default_factory=FortyGuardSolarIrradiance)
    availableMetricCount: int = 0


class FortyGuardTemperatureDistribution(CamelModel):
    overallC: list[float] = Field(default_factory=list)
    normalXAxisC: list[float] = Field(default_factory=list)
    normalDensity: list[float] = Field(default_factory=list)
    frequency: dict[str, float] = Field(default_factory=dict)


class FortyGuardMapStatistics(CamelModel):
    tileCount: int = 0
    minTemperatureC: float | None = None
    maxTemperatureC: float | None = None
    meanTemperatureC: float | None = None
    standardDeviationC: float | None = None
    distribution: FortyGuardTemperatureDistribution = Field(default_factory=FortyGuardTemperatureDistribution)


class FortyGuardAdvancedSnapshot(CamelModel):
    siteId: str
    siteName: str
    observedAt: str
    timezoneName: str
    sourceAgeHours: int = 0
    granularityMeters: int
    temperatureC: float
    heatmapActivityId: str
    environmentActivityId: str | None = None
    mapStatistics: FortyGuardMapStatistics
    environment: FortyGuardEnvironmentalEvidence
    dataStatus: Literal['verified', 'partial'] = 'verified'
    warnings: list[str] = Field(default_factory=list)


HeatIntelligenceAnalysis = Literal['geographic', 'environmental', 'urban', 'events', 'anthropogenic']


class FortyGuardHeatIntelligenceRequest(CamelModel):
    date: str | None = None
    time: str | None = None
    granularityMeters: Literal[60, 80, 100] = 100
    analysis: list[HeatIntelligenceAnalysis] = Field(
        default_factory=lambda: ['geographic', 'environmental', 'urban', 'events', 'anthropogenic'],
        min_length=1,
        max_length=5,
    )

    @model_validator(mode='after')
    def validate_request(self):
        if self.time and not self.date:
            raise ValueError('Choose a date when specifying a Heat Intelligence time.')
        self.analysis = list(dict.fromkeys(self.analysis))
        return self


class FortyGuardHeatIntelligenceSubmission(CamelModel):
    activityId: str
    siteId: str
    siteName: str
    observedAt: str
    temperatureC: float
    analysis: list[HeatIntelligenceAnalysis]
    status: Literal['submitted'] = 'submitted'
    message: str


class FortyGuardHeatIntelligenceStatus(CamelModel):
    activityId: str
    status: Literal['processing', 'completed', 'failed', 'unknown']
    ready: bool = False
    message: str | None = None


class FortyGuardUsageSummary(CamelModel):
    dataStatus: Literal['verified', 'unavailable', 'configuration_required']
    plan: str | None = None
    monthlyCredits: float | None = None
    usedCredits: float | None = None
    remainingCredits: float | None = None
    creditsResetDate: str | None = None
    activityBreakdown: dict[str, float] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)
    message: str | None = None
