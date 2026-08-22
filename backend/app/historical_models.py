from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel, Coordinate


class HistoricalHeatBehaviorRequest(CamelModel):
    periodDays: Literal[7, 30, 90] = 30
    startDate: str | None = None
    endDate: str | None = None
    thresholdF: float = Field(default=95.0, ge=-20.0, le=160.0)
    granularityMeters: int = 100

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        if bool(self.startDate) != bool(self.endDate):
            raise ValueError('Historical analysis needs both startDate and endDate for a custom range.')
        return self


class HistoricalLayerStatus(CamelModel):
    analyticType: Literal['exceedance', 'persistence', 'time_of_measure']
    status: Literal['verified', 'unavailable']
    activityId: str | None = None
    cellCount: int = 0
    units: str | None = None
    minValue: float | None = None
    maxValue: float | None = None
    meanValue: float | None = None
    message: str | None = None


class HistoricalHeatCell(CamelModel):
    id: str
    polygon: list[Coordinate]
    exceedanceHours: float | None = None
    persistenceHours: float | None = None
    peakHourUtc: int | None = None
    peakHourLocal: str | None = None


class HistoricalZoneSample(CamelModel):
    zoneId: str
    zoneName: str
    zoneType: str
    evidenceStatus: Literal['complete', 'partial', 'unmatched']
    exceedanceHours: float | None = None
    persistenceHours: float | None = None
    peakHourUtc: int | None = None
    peakHourLocal: str | None = None


class HistoricalHeatBehaviorResponse(CamelModel):
    siteId: str
    siteName: str
    startDate: str
    endDate: str
    dayCount: int
    thresholdF: float
    thresholdC: float
    timezoneName: str
    granularityMeters: int
    dataStatus: Literal['verified', 'partial', 'unavailable', 'configuration_required']
    generatedAt: str
    providerRequestCount: int = 0
    cellCount: int = 0
    meanExceedanceHours: float | None = None
    maxExceedanceHours: float | None = None
    meanPersistenceHours: float | None = None
    maxPersistenceHours: float | None = None
    commonPeakHourUtc: int | None = None
    commonPeakHourLocal: str | None = None
    commonPeakPeriodLocal: str | None = None
    layers: list[HistoricalLayerStatus] = Field(default_factory=list)
    cells: list[HistoricalHeatCell] = Field(default_factory=list)
    zones: list[HistoricalZoneSample] = Field(default_factory=list)
    message: str | None = None
    cached: bool = False
