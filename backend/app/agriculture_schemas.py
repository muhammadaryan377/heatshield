from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas import CamelModel, Coordinate


class AgricultureField(CamelModel):
    id: str
    siteId: str
    name: str
    crop: str | None = None
    growthStage: str | None = None
    center: Coordinate
    polygon: list[Coordinate]
    status: Literal['active', 'inactive'] = 'active'


class AgricultureFieldCreate(CamelModel):
    name: str = Field(min_length=2, max_length=120)
    crop: str | None = Field(default=None, max_length=120)
    growthStage: str | None = Field(default=None, max_length=120)
    polygon: list[Coordinate]

    @field_validator('name', 'crop', 'growthStage')
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator('polygon')
    @classmethod
    def validate_polygon(cls, value: list[Coordinate]) -> list[Coordinate]:
        if len(value) < 3:
            raise ValueError('A field boundary needs at least three map points.')
        if len(value) > 80:
            raise ValueError('A field boundary can contain at most 80 map points.')
        return value


class AgricultureFieldHeatRequest(CamelModel):
    date: str | None = None
    thresholdC: float = Field(default=35.0, ge=-30.0, le=70.0)
    granularityMeters: int = 100

    @model_validator(mode='after')
    def validate_request(self):
        if self.granularityMeters not in {60, 80, 100}:
            raise ValueError('FortyGuard granularity must be 60, 80, or 100 meters.')
        return self


class AgricultureFieldHeatCell(CamelModel):
    id: str
    value: float
    polygon: list[Coordinate]


class AgricultureFieldHeatLayer(CamelModel):
    analyticType: Literal['tcm', 'time_of_measure', 'exceedance', 'persistence']
    status: Literal['verified', 'unavailable']
    activityId: str | None = None
    units: str | None = None
    minValue: float | None = None
    maxValue: float | None = None
    meanValue: float | None = None
    cells: list[AgricultureFieldHeatCell] = Field(default_factory=list)
    message: str | None = None


class AgricultureFieldHeatProfile(CamelModel):
    siteId: str
    fieldId: str
    fieldName: str
    date: str
    timezoneName: str
    thresholdC: float
    granularityMeters: int
    dataStatus: Literal['verified', 'partial', 'unavailable', 'configuration_required']
    generatedAt: str
    providerRequestCount: int = 0
    minTemperatureC: float | None = None
    meanTemperatureC: float | None = None
    maxTemperatureC: float | None = None
    peakHourUtc: int | None = None
    peakHourLocal: str | None = None
    meanHoursAboveThreshold: float | None = None
    maxHoursAboveThreshold: float | None = None
    meanPersistenceHours: float | None = None
    maxPersistenceHours: float | None = None
    layers: list[AgricultureFieldHeatLayer] = Field(default_factory=list)
    message: str | None = None
    cached: bool = False
