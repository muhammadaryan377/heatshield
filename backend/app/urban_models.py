from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.schemas import CamelModel


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
