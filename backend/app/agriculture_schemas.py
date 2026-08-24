from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas import CamelModel, Coordinate


def _orientation(a: Coordinate, b: Coordinate, c: Coordinate, epsilon: float = 1e-12) -> int:
    value = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng)
    if abs(value) <= epsilon:
        return 0
    return 1 if value > 0 else -1


def _on_segment(a: Coordinate, b: Coordinate, point: Coordinate, epsilon: float = 1e-12) -> bool:
    return (
        min(a.lat, b.lat) - epsilon <= point.lat <= max(a.lat, b.lat) + epsilon
        and min(a.lng, b.lng) - epsilon <= point.lng <= max(a.lng, b.lng) + epsilon
    )


def _segments_intersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate) -> bool:
    o1 = _orientation(a, b, c)
    o2 = _orientation(a, b, d)
    o3 = _orientation(c, d, a)
    o4 = _orientation(c, d, b)
    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and _on_segment(a, b, c):
        return True
    if o2 == 0 and _on_segment(a, b, d):
        return True
    if o3 == 0 and _on_segment(c, d, a):
        return True
    if o4 == 0 and _on_segment(c, d, b):
        return True
    return False


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

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError('Field name must contain at least two non-space characters.')
        return cleaned

    @field_validator('crop', 'growthStage')
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
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

        distinct = {(point.lat, point.lng) for point in value}
        if len(distinct) < 3:
            raise ValueError('A field boundary needs at least three distinct map points.')

        twice_area = 0.0
        for index, point in enumerate(value):
            next_point = value[(index + 1) % len(value)]
            twice_area += point.lng * next_point.lat - next_point.lng * point.lat
        if abs(twice_area) <= 1e-12:
            raise ValueError('Field boundary points must enclose a non-zero area.')

        edge_count = len(value)
        for first in range(edge_count):
            a = value[first]
            b = value[(first + 1) % edge_count]
            for second in range(first + 1, edge_count):
                # Adjacent edges legitimately share one endpoint. The first and
                # final polygon edges are adjacent as well.
                if second == first or second == (first + 1) % edge_count:
                    continue
                if first == 0 and second == edge_count - 1:
                    continue
                c = value[second]
                d = value[(second + 1) % edge_count]
                if _segments_intersect(a, b, c, d):
                    raise ValueError('Field boundary cannot cross itself. Redraw the polygon without intersecting edges.')
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
