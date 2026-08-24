from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import httpx

from app.core.config import Settings
from app.fortyguard_models import (
    EnvironmentalContextRequest,
    EnvironmentalContextResponse,
    FortyGuardUsageResponse,
    HeatIntelligenceRequest,
    HeatIntelligenceResponse,
    SegmentationView,
    SitePhysicalContextRequest,
    SitePhysicalContextResponse,
)
from app.services.fortyguard import (
    FortyGuardAPIError,
    FortyGuardClient,
    FortyGuardConfigurationError,
    _OBSERVATION_CACHE,
)
from app.services.store import HeatShieldStore


_REPORT_CACHE: dict[str, tuple[datetime, bytes]] = {}
_REPORT_TTL = timedelta(minutes=20)
_MAX_REPORT_BYTES = 25 * 1024 * 1024


def _number(value: Any, index: int = 0) -> float | None:
    candidate = value[index] if isinstance(value, list) and len(value) > index else value
    if isinstance(candidate, bool):
        return None
    if isinstance(candidate, (int, float)):
        return float(candidate)
    if isinstance(candidate, str):
        try:
            parsed = float(candidate)
            # Sentinel values used by environmental feeds should not be shown as real measurements.
            if parsed <= -9000:
                return None
            return parsed
        except ValueError:
            return None
    return None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _data_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    cleaned = value.strip()
    if cleaned.startswith('data:image/'):
        return cleaned
    return f'data:image/png;base64,{cleaned}'


def _segments(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, float] = {}
    for key, raw in value.items():
        parsed = _number(raw)
        if parsed is not None:
            output[str(key)] = parsed
    return output


def _status_from_error(exc: Exception) -> str:
    message = str(exc).casefold()
    if 'http 403' in message or 'premium' in message or 'insufficient plan' in message:
        return 'premium_required'
    return 'unavailable'


def _first_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return {}


def _usage_number(data: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if key in data:
            parsed = _number(data.get(key))
            if parsed is not None:
                return parsed
    return None


def _usage_text(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = _text(data.get(key))
        if value:
            return value
    return None


def get_cached_heat_intelligence_report(report_id: str) -> bytes | None:
    now = datetime.now(timezone.utc)
    stale = [key for key, (created, _) in _REPORT_CACHE.items() if now - created > _REPORT_TTL]
    for key in stale:
        _REPORT_CACHE.pop(key, None)
    entry = _REPORT_CACHE.get(report_id)
    return entry[1] if entry else None


class FortyGuardSuiteService:
    """Expose FortyGuard capabilities without fabricating provider evidence.

    Premium-only endpoints degrade to a clear ``premium_required`` state. Base64
    imagery is returned only after provider completion. Heat Intelligence signed
    URLs are consumed server-side and replaced with a short-lived HeatShield
    report id so the temporary provider URL is never sent to the browser.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    async def environmental_context(
        self,
        site_id: str,
        request: EnvironmentalContextRequest,
    ) -> EnvironmentalContextResponse:
        site = self.store.get_site(site_id)
        if request.forceRefresh:
            _OBSERVATION_CACHE.pop(site.id, None)

        try:
            observation = await self.fortyguard.fetch_observation(site=site)
        except FortyGuardConfigurationError:
            return EnvironmentalContextResponse(
                siteId=site.id,
                dataStatus='configuration_required',
                message='FortyGuard API key is not configured.',
            )
        except FortyGuardAPIError as exc:
            return EnvironmentalContextResponse(
                siteId=site.id,
                dataStatus='unavailable',
                message=str(exc),
            )

        environment = observation.provider_payload.get('environment')
        environment = environment if isinstance(environment, dict) else {}
        location = environment.get('location') if isinstance(environment.get('location'), dict) else {}
        parameters = location.get('parameters') if isinstance(location.get('parameters'), dict) else {}
        solar = location.get('solar_irradiance') if isinstance(location.get('solar_irradiance'), dict) else {}
        clear_sky = solar.get('clear_sky') if isinstance(solar.get('clear_sky'), dict) else {}

        available = sum(
            value is not None
            for value in (
                _number(parameters.get('wet_bulb_temperature_celsius')),
                _number(parameters.get('aqi_us')),
                _number(clear_sky.get('ghi')),
                _number(parameters.get('precipitation_mm')),
            )
        )

        return EnvironmentalContextResponse(
            siteId=site.id,
            dataStatus='verified' if available >= 2 else 'partial',
            observedAt=observation.observed_at,
            timezoneName=observation.timezone_name,
            activityId=_text(observation.provider_payload.get('environment_activity_id')),
            heatmapActivityId=_text(observation.provider_payload.get('heatmap_activity_id')),
            temperatureC=observation.temperature_c,
            heatIndexC=observation.heat_index_c,
            apparentTemperatureC=observation.apparent_temperature_c,
            wetBulbTemperatureC=_number(parameters.get('wet_bulb_temperature_celsius')),
            relativeHumidityPercent=observation.humidity_percent,
            precipitationMm=_number(parameters.get('precipitation_mm')),
            cloudCoverMetric=_number(parameters.get('cloud_cover_metric')),
            aqiUs=_number(parameters.get('aqi_us')),
            aqiPm25=_number(parameters.get('aqi_us_pm25')),
            aqiPm10=_number(parameters.get('aqi_us_pm10')),
            aqiNo2=_number(parameters.get('aqi_us_no2')),
            aqiCo=_number(parameters.get('aqi_us_co')),
            aqiO3=_number(parameters.get('aqi_us_o3')),
            aqiSo2=_number(parameters.get('aqi_us_so2')),
            methanePpb=_number(parameters.get('methane_ppb')),
            co2Ppm=_number(parameters.get('co2_ppm')),
            solarGhi=_number(clear_sky.get('ghi')),
            solarDni=_number(clear_sky.get('dni')),
            solarDhi=_number(clear_sky.get('dhi')),
            solarDescription=_text(solar.get('description')),
            message=(
                'FortyGuard environmental parameters are verified for the same temperature observation.'
                if available >= 2
                else 'Core FortyGuard heat metrics are verified; some premium environmental parameters were not returned.'
            ),
            cached=not request.forceRefresh,
        )

    @staticmethod
    def _segmentation_view(
        result: dict[str, Any],
        *,
        activity_id: str,
        street_key: str | None = None,
    ) -> SegmentationView:
        if street_key:
            view = result.get(street_key) if isinstance(result.get(street_key), dict) else {}
            return SegmentationView(
                status='verified' if view else 'unavailable',
                activityId=activity_id,
                imageDataUrl=_data_url(view.get('original_image')),
                segmentedImageDataUrl=_data_url(view.get('segmented_image')),
                imageDate=_text(view.get('image_date')),
                segments=_segments(view.get('segments')),
                legend=view.get('image_legend') if isinstance(view.get('image_legend'), dict) else {},
                message=None if view else f'FortyGuard did not return the {street_key} street-view payload.',
            )

        segmentation = result.get('segmentation') if isinstance(result.get('segmentation'), dict) else {}
        originals = result.get('orignal_image')
        original = originals[0] if isinstance(originals, list) and originals else originals
        image_year = result.get('image_year')
        return SegmentationView(
            status='verified' if segmentation else 'unavailable',
            activityId=activity_id,
            imageDataUrl=_data_url(original),
            segmentedImageDataUrl=_data_url(segmentation.get('image_content')),
            imageYear=int(image_year) if isinstance(image_year, (int, float)) else None,
            segments=_segments(segmentation.get('segments')),
            legend=segmentation.get('image_legend') if isinstance(segmentation.get('image_legend'), dict) else {},
            processingTimeSeconds=_number(segmentation.get('processing_time_seconds')),
            message=None if segmentation else 'FortyGuard did not return satellite segmentation output.',
        )

    async def physical_context(
        self,
        site_id: str,
        request: SitePhysicalContextRequest,
    ) -> SitePhysicalContextResponse:
        site = self.store.get_site(site_id)
        generated_at = datetime.now(timezone.utc).isoformat()
        try:
            observation = await self.fortyguard.fetch_observation(site=site)
        except FortyGuardConfigurationError:
            return SitePhysicalContextResponse(
                siteId=site.id,
                dataStatus='configuration_required',
                generatedAt=generated_at,
                message='FortyGuard API key is not configured.',
            )
        except FortyGuardAPIError as exc:
            return SitePhysicalContextResponse(
                siteId=site.id,
                dataStatus='unavailable',
                generatedAt=generated_at,
                message=f'A matched FortyGuard heat observation is required before segmentation: {exc}',
            )

        requested_date_time = observation.provider_payload.get('requested_date_time')
        if not isinstance(requested_date_time, dict):
            requested_date_time = {
                'start_date': observation.observed_at[:10],
                'start_time': '12:00',
                'filter_type': 1,
            }

        satellite: SegmentationView | None = None
        street_front: SegmentationView | None = None
        street_back: SegmentationView | None = None
        messages: list[str] = []

        if request.includeSatellite:
            satellite_activity: str | None = None
            try:
                satellite_activity = await self.fortyguard._submit('/v1/satellite', {
                    'sat': {'latitude': site.center.lat, 'longitude': site.center.lng},
                    'date_time': requested_date_time,
                    'granularity': request.granularityMeters,
                })
                satellite_result = await self.fortyguard._wait(satellite_activity)
                satellite = self._segmentation_view(satellite_result, activity_id=satellite_activity)
            except FortyGuardAPIError as exc:
                status = _status_from_error(exc)
                satellite = SegmentationView(status=status, activityId=satellite_activity, message=str(exc))
                messages.append(f'Satellite: {exc}')

        if request.includeStreetView:
            street_activity: str | None = None
            try:
                street_activity = await self.fortyguard._submit('/v1/streetview', {
                    'latitude': site.center.lat,
                    'longitude': site.center.lng,
                    'vertical_angle': request.streetVerticalAngle,
                    'horizontal_angle': request.streetHorizontalAngle,
                    'back_view': request.streetBackView,
                })
                street_result = await self.fortyguard._wait(street_activity)
                street_front = self._segmentation_view(street_result, activity_id=street_activity, street_key='front')
                if request.streetBackView:
                    street_back = self._segmentation_view(street_result, activity_id=street_activity, street_key='back')
            except FortyGuardAPIError as exc:
                status = _status_from_error(exc)
                street_front = SegmentationView(status=status, activityId=street_activity, message=str(exc))
                messages.append(f'Street view: {exc}')

        statuses = [item.status for item in (satellite, street_front, street_back) if item is not None]
        if statuses and all(status == 'verified' for status in statuses):
            data_status = 'verified'
        elif any(status == 'verified' for status in statuses):
            data_status = 'partial'
        elif any(status == 'premium_required' for status in statuses):
            data_status = 'premium_required'
        else:
            data_status = 'unavailable'

        return SitePhysicalContextResponse(
            siteId=site.id,
            dataStatus=data_status,
            generatedAt=generated_at,
            observationTime=observation.observed_at,
            satellite=satellite,
            streetFront=street_front,
            streetBack=street_back,
            message=' '.join(messages) if messages else 'FortyGuard physical context is linked to the matched site heat observation.',
        )

    async def heat_intelligence(
        self,
        site_id: str,
        request: HeatIntelligenceRequest,
    ) -> HeatIntelligenceResponse:
        site = self.store.get_site(site_id)
        try:
            observation = await self.fortyguard.fetch_observation(site=site)
        except FortyGuardConfigurationError:
            return HeatIntelligenceResponse(
                siteId=site.id,
                dataStatus='configuration_required',
                analysis=list(request.analysis),
                message='FortyGuard API key is not configured.',
            )
        except FortyGuardAPIError as exc:
            return HeatIntelligenceResponse(
                siteId=site.id,
                dataStatus='unavailable',
                analysis=list(request.analysis),
                message=f'Heat Intelligence needs a matched FortyGuard temperature observation: {exc}',
            )

        activity_id: str | None = None
        try:
            activity_id = await self.fortyguard._submit('/v1/heat_intelligence', {
                'latitude': site.center.lat,
                'longitude': site.center.lng,
                'temperature': observation.temperature_c,
                'date': observation.observed_at[:10],
                'analysis': list(request.analysis),
            })
            result = await self.fortyguard._wait(activity_id)
            download_link = _text(result.get('download_link'))
            if not download_link:
                raise FortyGuardAPIError('FortyGuard completed Heat Intelligence without a download_link.')

            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                response = await client.get(download_link)
                response.raise_for_status()
                content = response.content
            if not content or len(content) > _MAX_REPORT_BYTES:
                raise FortyGuardAPIError('FortyGuard Heat Intelligence PDF was empty or exceeded the safe download limit.')

            report_id = uuid4().hex
            _REPORT_CACHE[report_id] = (datetime.now(timezone.utc), content)
            return HeatIntelligenceResponse(
                siteId=site.id,
                dataStatus='verified',
                activityId=activity_id,
                reportId=report_id,
                downloadPath=f'/api/fortyguard/reports/{report_id}',
                observedAt=observation.observed_at,
                analysis=list(request.analysis),
                message='FortyGuard Heat Intelligence report is ready. The provider signed URL was consumed server-side.',
            )
        except (FortyGuardAPIError, httpx.HTTPError) as exc:
            return HeatIntelligenceResponse(
                siteId=site.id,
                dataStatus=_status_from_error(exc),
                activityId=activity_id,
                observedAt=observation.observed_at,
                analysis=list(request.analysis),
                message=str(exc),
            )

    async def usage(self) -> FortyGuardUsageResponse:
        fetched_at = datetime.now(timezone.utc).isoformat()
        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            return FortyGuardUsageResponse(
                dataStatus='configuration_required',
                fetchedAt=fetched_at,
                message='FortyGuard API key is not configured.',
            )

        try:
            body = await self.fortyguard._request('POST', '/v1/system/fetch-api-key-usage', json={})
        except FortyGuardAPIError as exc:
            return FortyGuardUsageResponse(
                dataStatus='unavailable',
                fetchedAt=fetched_at,
                message=str(exc),
            )

        data = body.get('data') if isinstance(body.get('data'), dict) else body
        if not isinstance(data, dict):
            data = {}
        breakdown = data.get('activity_breakdown') or data.get('activityBreakdown') or data.get('usage_by_activity')
        return FortyGuardUsageResponse(
            dataStatus='verified',
            fetchedAt=fetched_at,
            plan=_usage_text(data, 'plan', 'plan_name', 'subscription_plan', 'subscription'),
            creditsUsed=_usage_number(data, 'credits_used', 'used_credits', 'creditsUsed', 'usage'),
            creditsRemaining=_usage_number(data, 'credits_remaining', 'remaining_credits', 'creditsRemaining'),
            creditsLimit=_usage_number(data, 'credits_limit', 'monthly_credits', 'credit_limit', 'creditsLimit'),
            creditsResetDate=_usage_text(data, 'credits_reset_date', 'reset_date', 'creditsResetDate'),
            activityBreakdown=breakdown if isinstance(breakdown, dict) else {},
            raw=data,
            message='FortyGuard credit usage retrieved from the provider system endpoint.',
        )
