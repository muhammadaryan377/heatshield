from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any

from app.core.config import Settings
from app.schemas import Coordinate
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.store import HeatShieldStore
from app.urban_models import UrbanMorphologyRequest, UrbanMorphologyResponse, UrbanSegmentationLayer


_MORPHOLOGY_CACHE: dict[str, tuple[datetime, UrbanMorphologyResponse]] = {}
_COOLING_TERMS = ('tree', 'vegetation', 'grass', 'green', 'plant', 'water', 'shrub', 'canopy')
_HEAT_STORING_TERMS = ('road', 'asphalt', 'concrete', 'building', 'roof', 'parking', 'pavement', 'sidewalk')


def _point_in_polygon(point: Coordinate, polygon: list[Coordinate]) -> bool:
    if len(polygon) < 3:
        return False
    inside = False
    j = len(polygon) - 1
    for i, current in enumerate(polygon):
        previous = polygon[j]
        intersects = (current.lat > point.lat) != (previous.lat > point.lat) and point.lng < (
            (previous.lng - current.lng) * (point.lat - current.lat) / (previous.lat - current.lat) + current.lng
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _normalize_segments(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, float] = {}
    for key, raw in value.items():
        parsed = _number(raw)
        if parsed is None:
            continue
        output[str(key)] = max(0.0, parsed)
    if output and max(output.values()) <= 1.0001:
        output = {key: amount * 100.0 for key, amount in output.items()}
    return {key: round(amount, 3) for key, amount in output.items()}


def _image_data_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.startswith('data:image/'):
        return text
    mime = 'image/jpeg' if text.startswith('/9j/') else 'image/png'
    return f'data:{mime};base64,{text}'


def _satellite_layer(activity_id: str | None, result: dict[str, Any] | None, error: str | None) -> UrbanSegmentationLayer:
    if not isinstance(result, dict):
        return UrbanSegmentationLayer(kind='satellite', status='unavailable', activityId=activity_id, message=error)

    segmentation = result.get('segmentation') if isinstance(result.get('segmentation'), dict) else {}
    segments = _normalize_segments(segmentation.get('segments'))
    raw_original = result.get('orignal_image', result.get('original_image'))
    if isinstance(raw_original, list):
        raw_original = raw_original[0] if raw_original else None
    original = _image_data_url(raw_original)
    segmented = _image_data_url(segmentation.get('image_content'))
    image_year = result.get('image_year')
    parsed_year = int(image_year) if isinstance(image_year, (int, float)) else None

    if not segments and not original and not segmented:
        return UrbanSegmentationLayer(
            kind='satellite', status='unavailable', activityId=activity_id,
            imageYear=parsed_year, message=error or 'FortyGuard satellite segmentation returned no usable imagery or class coverage.',
        )

    return UrbanSegmentationLayer(
        kind='satellite', status='verified', activityId=activity_id, imageYear=parsed_year,
        segments=segments, originalImageDataUrl=original, segmentedImageDataUrl=segmented,
        message='FortyGuard satellite segmentation verified for the selected hotspot.',
    )


def _street_layer(activity_id: str | None, result: dict[str, Any] | None, error: str | None) -> UrbanSegmentationLayer:
    if not isinstance(result, dict):
        return UrbanSegmentationLayer(kind='streetview', status='unavailable', activityId=activity_id, message=error)

    front = result.get('front') if isinstance(result.get('front'), dict) else {}
    segments = _normalize_segments(front.get('segments'))
    original = _image_data_url(front.get('original_image'))
    segmented = _image_data_url(front.get('segmented_image'))
    image_date = str(front.get('image_date')) if front.get('image_date') else None

    if not segments and not original and not segmented:
        return UrbanSegmentationLayer(
            kind='streetview', status='unavailable', activityId=activity_id,
            imageDate=image_date, message=error or 'FortyGuard street-view segmentation returned no usable imagery or class coverage.',
        )

    return UrbanSegmentationLayer(
        kind='streetview', status='verified', activityId=activity_id, imageDate=image_date,
        segments=segments, originalImageDataUrl=original, segmentedImageDataUrl=segmented,
        message='FortyGuard street-view segmentation verified for the selected hotspot.',
    )


def _coverage(layers: list[UrbanSegmentationLayer], terms: tuple[str, ...]) -> float | None:
    values: list[float] = []
    for layer in layers:
        if layer.status != 'verified':
            continue
        subtotal = sum(
            amount for label, amount in layer.segments.items()
            if any(term in label.casefold() for term in terms)
        )
        if subtotal > 0:
            values.append(subtotal)
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _dominant(layers: list[UrbanSegmentationLayer]) -> list[str]:
    combined: dict[str, list[float]] = {}
    for layer in layers:
        if layer.status != 'verified':
            continue
        for label, amount in layer.segments.items():
            combined.setdefault(label, []).append(amount)
    ranked = sorted(
        ((label, sum(values) / len(values)) for label, values in combined.items()),
        key=lambda item: item[1], reverse=True,
    )
    return [label for label, _ in ranked[:6]]


class UrbanMorphologyService:
    """Run optional FortyGuard Premium urban-form segmentation at one verified hotspot.

    The satellite timestamp is deliberately tied to the already-verified thermal
    observation. Street view is contextual and does not imply the imagery date
    matches the thermal observation; its capture date is returned separately.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    @staticmethod
    def _cache_key(site_id: str, request: UrbanMorphologyRequest) -> str:
        raw = (
            f'{site_id}|{request.latitude:.6f}|{request.longitude:.6f}|{request.observedAt}|'
            f'{request.granularityMeters}|{request.includeStreetView}'
        )
        return sha1(raw.encode('utf-8')).hexdigest()

    def _cached(self, key: str, now: datetime) -> UrbanMorphologyResponse | None:
        cached = _MORPHOLOGY_CACHE.get(key)
        if not cached:
            return None
        cached_at, response = cached
        ttl = max(0, self.settings.fortyguard_cache_ttl_seconds)
        if ttl and (now - cached_at).total_seconds() <= ttl:
            return response
        _MORPHOLOGY_CACHE.pop(key, None)
        return None

    def _store_cache(self, key: str, now: datetime, response: UrbanMorphologyResponse) -> None:
        if self.settings.fortyguard_cache_ttl_seconds > 0:
            _MORPHOLOGY_CACHE[key] = (now, response)

    async def _satellite(self, request: UrbanMorphologyRequest) -> UrbanSegmentationLayer:
        activity_id: str | None = None
        try:
            observed = datetime.fromisoformat(request.observedAt.replace('Z', '+00:00'))
        except ValueError:
            return UrbanSegmentationLayer(
                kind='satellite', status='unavailable',
                message='Verified thermal timestamp could not be parsed for satellite matching.',
            )

        try:
            activity_id = await self.fortyguard._submit('/v1/satellite', {
                'sat': {'latitude': request.latitude, 'longitude': request.longitude},
                'date_time': {
                    'start_date': observed.date().isoformat(),
                    'start_time': observed.strftime('%H:%M'),
                    'filter_type': 1,
                },
                'granularity': request.granularityMeters,
            })
            result = await self.fortyguard._wait(activity_id)
            return _satellite_layer(activity_id, result, None)
        except FortyGuardAPIError as exc:
            return _satellite_layer(activity_id, None, str(exc))

    async def _streetview(self, request: UrbanMorphologyRequest) -> UrbanSegmentationLayer:
        if not request.includeStreetView:
            return UrbanSegmentationLayer(kind='streetview', status='unavailable', message='Street-view scan was not requested.')

        activity_id: str | None = None
        try:
            activity_id = await self.fortyguard._submit('/v1/streetview', {
                'latitude': request.latitude,
                'longitude': request.longitude,
                'vertical_angle': 10.0,
                'horizontal_angle': 0.0,
                'back_view': False,
            })
            result = await self.fortyguard._wait(activity_id)
            return _street_layer(activity_id, result, None)
        except FortyGuardAPIError as exc:
            return _street_layer(activity_id, None, str(exc))

    async def generate(self, site_id: str, request: UrbanMorphologyRequest) -> UrbanMorphologyResponse:
        site = self.store.get_site(site_id)
        point = Coordinate(lat=request.latitude, lng=request.longitude)
        if not _point_in_polygon(point, site.polygon):
            raise ValueError('Urban morphology point must stay inside the selected district boundary.')

        try:
            _ = datetime.fromisoformat(request.observedAt.replace('Z', '+00:00'))
        except ValueError as exc:
            raise ValueError('observedAt must be a valid ISO-8601 timestamp.') from exc

        now = datetime.now(timezone.utc)
        key = self._cache_key(site.id, request)
        cached = self._cached(key, now)
        if cached is not None:
            return cached

        unavailable_satellite = UrbanSegmentationLayer(kind='satellite', status='unavailable')
        unavailable_street = UrbanSegmentationLayer(kind='streetview', status='unavailable')
        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            response = UrbanMorphologyResponse(
                siteId=site.id, latitude=request.latitude, longitude=request.longitude,
                observedAt=request.observedAt, dataStatus='configuration_required',
                satellite=unavailable_satellite.model_copy(update={'message': 'FortyGuard API key is not configured.'}),
                streetView=unavailable_street.model_copy(update={'message': 'FortyGuard API key is not configured.'}),
                message='Urban morphology requires FortyGuard Premium segmentation access.',
            )
            self._store_cache(key, now, response)
            return response

        satellite, street = await asyncio.gather(self._satellite(request), self._streetview(request))
        verified_count = sum(layer.status == 'verified' for layer in (satellite, street))
        requested_count = 2 if request.includeStreetView else 1
        provider_count = sum(1 for layer in (satellite, street) if layer.activityId)

        if verified_count == requested_count:
            data_status = 'verified'
            message = 'FortyGuard urban morphology context is verified for all requested segmentation layers.'
        elif verified_count > 0:
            data_status = 'partial'
            message = 'Urban morphology is partial; one requested FortyGuard segmentation layer is unavailable.'
        else:
            data_status = 'unavailable'
            message = (
                satellite.message or street.message
                or 'FortyGuard segmentation returned no usable urban-form context for this hotspot.'
            )

        layers = [satellite, street]
        response = UrbanMorphologyResponse(
            siteId=site.id,
            latitude=request.latitude,
            longitude=request.longitude,
            observedAt=request.observedAt,
            dataStatus=data_status,
            providerRequestCount=provider_count,
            satellite=satellite,
            streetView=street,
            coolingCoveragePercent=_coverage(layers, _COOLING_TERMS),
            heatStoringCoveragePercent=_coverage(layers, _HEAT_STORING_TERMS),
            dominantClasses=_dominant(layers),
            message=message,
        )
        self._store_cache(key, now, response)
        return response
