from __future__ import annotations

import ipaddress
from datetime import date, datetime, time, timezone
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx

from app.advanced_models import (
    FortyGuardAdvancedSnapshot,
    FortyGuardAdvancedSnapshotRequest,
    FortyGuardAirQuality,
    FortyGuardEnvironmentalEvidence,
    FortyGuardHeatIntelligenceRequest,
    FortyGuardHeatIntelligenceStatus,
    FortyGuardHeatIntelligenceSubmission,
    FortyGuardMapStatistics,
    FortyGuardSolarIrradiance,
    FortyGuardTemperatureDistribution,
    FortyGuardUsageSummary,
)
from app.core.config import Settings
from app.schemas import Site
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError, FortyGuardNoTilesError
from app.services.store import HeatShieldStore


_ARCHIVE_START = date(2019, 1, 1)
_MAX_DISTRIBUTION_POINTS = 600


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


def _series_number(value: Any, *, minimum: float | None = None, maximum: float | None = None) -> float | None:
    candidate = value[0] if isinstance(value, list) and value else value
    parsed = _number(candidate)
    if parsed is None:
        return None
    if minimum is not None and parsed < minimum:
        return None
    if maximum is not None and parsed > maximum:
        return None
    return parsed


def _float_list(value: Any) -> list[float]:
    if not isinstance(value, list):
        return []
    output: list[float] = []
    for item in value[:_MAX_DISTRIBUTION_POINTS]:
        parsed = _number(item)
        if parsed is not None:
            output.append(parsed)
    return output


def _float_mapping(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, float] = {}
    for key, raw in list(value.items())[:_MAX_DISTRIBUTION_POINTS]:
        parsed = _number(raw)
        if parsed is not None:
            output[str(key)] = parsed
    return output


def _deep_find(data: Any, aliases: tuple[str, ...]) -> Any:
    wanted = {item.casefold() for item in aliases}
    if isinstance(data, dict):
        for key, value in data.items():
            normalized = str(key).casefold().replace('-', '_').replace(' ', '_')
            if normalized in wanted:
                return value
        for value in data.values():
            found = _deep_find(value, aliases)
            if found is not None:
                return found
    elif isinstance(data, list):
        for value in data:
            found = _deep_find(value, aliases)
            if found is not None:
                return found
    return None


def _sanitized_usage_payload(value: Any) -> Any:
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).casefold()
            if any(secret in lowered for secret in ('api_key', 'apikey', 'token', 'secret', 'signed_url', 'download_link')):
                continue
            output[str(key)] = _sanitized_usage_payload(item)
        return output
    if isinstance(value, list):
        return [_sanitized_usage_payload(item) for item in value[:200]]
    return value


class FortyGuardAdvancedService:
    """Capability-complete FortyGuard integration for HeatShield.

    This service keeps sponsor evidence separate from HeatShield-derived decisions.
    It consumes the provider's full environmental payload, full map statistics,
    Heat Intelligence reports, and account credit usage without exposing API keys
    or temporary signed report URLs to the browser.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)

    @staticmethod
    def _explicit_target(site: Site, request_date: str, request_time: str | None) -> tuple[str, datetime]:
        timezone_name, site_timezone = FortyGuardClient._site_timezone(site)
        try:
            selected_date = date.fromisoformat(request_date)
        except ValueError as exc:
            raise ValueError('FortyGuard date must use YYYY-MM-DD.') from exc
        if selected_date < _ARCHIVE_START:
            raise ValueError('FortyGuard archive begins at 2019-01-01.')
        try:
            selected_time = time.fromisoformat(request_time or '14:00')
        except ValueError as exc:
            raise ValueError('FortyGuard time must use HH:MM in 24-hour format.') from exc
        target = datetime.combine(selected_date, selected_time.replace(second=0, microsecond=0), tzinfo=site_timezone)
        local_now = datetime.now(timezone.utc).astimezone(site_timezone)
        if target > local_now:
            raise ValueError('Full environmental and Heat Intelligence evidence must use the present or a historical time. Forecast TCM remains available in the operational planner.')
        return timezone_name, target

    async def _temperature_context(
        self,
        site: Site,
        *,
        request_date: str | None,
        request_time: str | None,
        granularity: int,
    ) -> tuple[str, datetime, int, str, float, dict[str, Any], dict[str, Any]]:
        if request_date:
            timezone_name, target = self._explicit_target(site, request_date, request_time)
            candidates = [target]
        else:
            timezone_name, candidates = self.fortyguard._candidate_local_hours(site, datetime.now(timezone.utc))

        polygon_aoi = self.fortyguard._geojson_polygon(site)
        last_activity_id: str | None = None
        for age_hours, candidate in enumerate(candidates):
            payload = {
                'polygon_aoi': polygon_aoi,
                'date_time': self.fortyguard._date_time(candidate),
                'granularity': granularity,
                'analytic_type': 'tcm',
            }
            last_activity_id = await self.fortyguard._submit('/v1/heatmap', payload)
            result = await self.fortyguard._wait(last_activity_id)
            try:
                temperature, feature = self.fortyguard._extract_temperature(result, site)
            except FortyGuardNoTilesError:
                if request_date:
                    break
                continue
            return timezone_name, candidate, age_hours, last_activity_id, temperature, feature, result

        if request_date:
            raise FortyGuardAPIError('FortyGuard returned no usable temperature cells for the selected historical hour.')
        raise FortyGuardAPIError(
            f'FortyGuard returned no usable temperature cells for {len(candidates)} recent {timezone_name} whole-hour request(s).'
        )

    @staticmethod
    def _map_statistics(result: dict[str, Any]) -> FortyGuardMapStatistics:
        map_data = result.get('map_data') if isinstance(result.get('map_data'), dict) else {}
        features = map_data.get('features') if isinstance(map_data.get('features'), list) else []
        stats = result.get('stats_data') if isinstance(result.get('stats_data'), dict) else {}
        temperature_stats = stats.get('temperature_stats') if isinstance(stats.get('temperature_stats'), dict) else {}

        values = []
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get('properties') if isinstance(feature.get('properties'), dict) else {}
            parsed = FortyGuardClient._temperature_value(props)
            if parsed is not None:
                values.append(parsed)

        minimum = _number(temperature_stats.get('minimum'))
        maximum = _number(temperature_stats.get('maximum'))
        mean = _number(temperature_stats.get('mean'))
        stddev = _number(
            temperature_stats.get('standard_deviation', temperature_stats.get('std_dev', temperature_stats.get('stddev')))
        )
        overall = _float_list(stats.get('overall_temperature_distribution'))
        normal = stats.get('normal_temperature_distribution') if isinstance(stats.get('normal_temperature_distribution'), dict) else {}
        frequency = _float_mapping(stats.get('temperature_frequency'))

        return FortyGuardMapStatistics(
            tileCount=len(values),
            minTemperatureC=minimum if minimum is not None else (min(values) if values else None),
            maxTemperatureC=maximum if maximum is not None else (max(values) if values else None),
            meanTemperatureC=mean if mean is not None else (sum(values) / len(values) if values else None),
            standardDeviationC=stddev,
            distribution=FortyGuardTemperatureDistribution(
                overallC=overall,
                normalXAxisC=_float_list(normal.get('x_axis')),
                normalDensity=_float_list(normal.get('y_axis')),
                frequency=frequency,
            ),
        )

    @staticmethod
    def _environment(result: dict[str, Any]) -> tuple[FortyGuardEnvironmentalEvidence, str | None]:
        locations = result.get('locations')
        metadata = result.get('metadata') if isinstance(result.get('metadata'), dict) else {}
        if not isinstance(locations, list) or not locations or not isinstance(locations[0], dict):
            raise FortyGuardAPIError('FortyGuard environmental result contains no locations.')
        location = locations[0]
        parameters = location.get('parameters') if isinstance(location.get('parameters'), dict) else {}
        solar = location.get('solar_irradiance') if isinstance(location.get('solar_irradiance'), dict) else {}
        clear_sky = solar.get('clear_sky') if isinstance(solar.get('clear_sky'), dict) else {}

        air_quality = FortyGuardAirQuality(
            aqiUs=_series_number(parameters.get('aqi_us'), minimum=0, maximum=1000),
            pm25Aqi=_series_number(parameters.get('aqi_us_pm25'), minimum=0, maximum=1000),
            pm10Aqi=_series_number(parameters.get('aqi_us_pm10'), minimum=0, maximum=1000),
            no2Aqi=_series_number(parameters.get('aqi_us_no2'), minimum=0, maximum=1000),
            coAqi=_series_number(parameters.get('aqi_us_co'), minimum=0, maximum=1000),
            o3Aqi=_series_number(parameters.get('aqi_us_o3'), minimum=0, maximum=1000),
            so2Aqi=_series_number(parameters.get('aqi_us_so2'), minimum=0, maximum=1000),
        )
        solar_evidence = FortyGuardSolarIrradiance(
            ghiWm2=_series_number(clear_sky.get('ghi'), minimum=0),
            dniWm2=_series_number(clear_sky.get('dni'), minimum=0),
            dhiWm2=_series_number(clear_sky.get('dhi'), minimum=0),
            description=str(solar.get('description'))[:500] if solar.get('description') else None,
        )
        evidence = FortyGuardEnvironmentalEvidence(
            heatIndexC=_series_number(parameters.get('heat_index_celsius'), minimum=-80, maximum=100),
            apparentTemperatureC=_series_number(parameters.get('apparent_temperature_celsius'), minimum=-100, maximum=100),
            wetBulbTemperatureC=_series_number(parameters.get('wet_bulb_temperature_celsius'), minimum=-100, maximum=80),
            relativeHumidityPercent=_series_number(parameters.get('relative_humidity_percent'), minimum=0, maximum=100),
            precipitationMm=_series_number(parameters.get('precipitation_mm'), minimum=0),
            cloudCoverMetric=_series_number(parameters.get('cloud_cover_metric'), minimum=0),
            methanePpb=_series_number(parameters.get('methane_ppb'), minimum=0),
            co2Ppm=_series_number(parameters.get('co2_ppm'), minimum=0),
            elevationM=_number(location.get('elevation')),
            airQuality=air_quality,
            solar=solar_evidence,
        )
        metric_values = [
            evidence.heatIndexC,
            evidence.apparentTemperatureC,
            evidence.wetBulbTemperatureC,
            evidence.relativeHumidityPercent,
            evidence.precipitationMm,
            evidence.cloudCoverMetric,
            evidence.methanePpb,
            evidence.co2Ppm,
            air_quality.aqiUs,
            air_quality.pm25Aqi,
            air_quality.pm10Aqi,
            air_quality.no2Aqi,
            air_quality.coAqi,
            air_quality.o3Aqi,
            air_quality.so2Aqi,
            solar_evidence.ghiWm2,
            solar_evidence.dniWm2,
            solar_evidence.dhiWm2,
        ]
        evidence.availableMetricCount = sum(value is not None for value in metric_values)
        timestamps = metadata.get('timestamps') if isinstance(metadata.get('timestamps'), list) else []
        observed_at = str(timestamps[0]) if timestamps else None
        return evidence, observed_at

    async def snapshot(self, site_id: str, request: FortyGuardAdvancedSnapshotRequest) -> FortyGuardAdvancedSnapshot:
        site = self.store.get_site(site_id)
        _ = self.fortyguard.headers
        timezone_name, target, age_hours, heatmap_activity_id, temperature, _, heatmap_result = await self._temperature_context(
            site,
            request_date=request.date,
            request_time=request.time,
            granularity=request.granularityMeters,
        )
        environment_activity_id: str | None = None
        warnings: list[str] = []
        environment = FortyGuardEnvironmentalEvidence()
        environment_observed_at: str | None = None
        try:
            environment_activity_id = await self.fortyguard._submit('/v1/env_params', {
                'latitude': site.center.lat,
                'longitude': site.center.lng,
                'temperature': temperature,
                'date_time': self.fortyguard._date_time(target),
            })
            environment_result = await self.fortyguard._wait(environment_activity_id)
            environment, environment_observed_at = self._environment(environment_result)
        except FortyGuardAPIError as exc:
            warnings.append(f'Full environmental parameters unavailable: {exc}')

        observed_at = environment_observed_at or target.isoformat()
        status = 'verified' if environment.availableMetricCount >= 3 else 'partial'
        if environment.availableMetricCount < 10 and not warnings:
            warnings.append('FortyGuard returned a partial environmental payload. This can occur when the API plan limits environmental parameters.')
        return FortyGuardAdvancedSnapshot(
            siteId=site.id,
            siteName=site.name,
            observedAt=observed_at,
            timezoneName=timezone_name,
            sourceAgeHours=age_hours,
            granularityMeters=request.granularityMeters,
            temperatureC=temperature,
            heatmapActivityId=heatmap_activity_id,
            environmentActivityId=environment_activity_id,
            mapStatistics=self._map_statistics(heatmap_result),
            environment=environment,
            dataStatus=status,
            warnings=warnings,
        )

    async def submit_heat_intelligence(
        self,
        site_id: str,
        request: FortyGuardHeatIntelligenceRequest,
    ) -> FortyGuardHeatIntelligenceSubmission:
        site = self.store.get_site(site_id)
        _ = self.fortyguard.headers
        _, target, _, _, temperature, _, _ = await self._temperature_context(
            site,
            request_date=request.date,
            request_time=request.time,
            granularity=request.granularityMeters,
        )
        activity_id = await self.fortyguard._submit('/v1/heat_intelligence', {
            'latitude': site.center.lat,
            'longitude': site.center.lng,
            'temperature': temperature,
            'date': target.date().isoformat(),
            'analysis': request.analysis,
        })
        return FortyGuardHeatIntelligenceSubmission(
            activityId=activity_id,
            siteId=site.id,
            siteName=site.name,
            observedAt=target.isoformat(),
            temperatureC=temperature,
            analysis=request.analysis,
            message='FortyGuard Heat Intelligence report submitted. HeatShield will expose the PDF only after provider completion.',
        )

    async def heat_intelligence_status(self, activity_id: str) -> tuple[FortyGuardHeatIntelligenceStatus, str | None]:
        body = await self.fortyguard._request('GET', f'/v1/status/{activity_id}')
        data = body.get('data') if isinstance(body.get('data'), dict) else {}
        raw_status = str(data.get('status', '')).strip().casefold()
        if raw_status in {'completed', 'succeeded'}:
            result = data.get('result') if isinstance(data.get('result'), dict) else {}
            download_link = result.get('download_link') if isinstance(result.get('download_link'), str) else None
            return FortyGuardHeatIntelligenceStatus(
                activityId=activity_id,
                status='completed',
                ready=bool(download_link),
                message='Provider report is ready.' if download_link else 'Provider marked the report complete but did not return a download link.',
            ), download_link
        if raw_status in {'failed', 'error'}:
            message = data.get('message') or data.get('error') or body.get('message')
            return FortyGuardHeatIntelligenceStatus(
                activityId=activity_id,
                status='failed',
                ready=False,
                message=str(message)[:500] if message else 'FortyGuard report generation failed.',
            ), None
        if raw_status in {'processing', 'pending', 'queued', 'running'}:
            return FortyGuardHeatIntelligenceStatus(
                activityId=activity_id,
                status='processing',
                ready=False,
                message='FortyGuard is generating the report.',
            ), None
        return FortyGuardHeatIntelligenceStatus(
            activityId=activity_id,
            status='unknown',
            ready=False,
            message=f'Provider returned status {raw_status or "unknown"}.',
        ), None

    @staticmethod
    def _validate_download_link(value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != 'https' or not parsed.hostname:
            raise FortyGuardAPIError('FortyGuard returned an invalid report download URL.')
        try:
            address = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            address = None
        if address and (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved):
            raise FortyGuardAPIError('FortyGuard report URL resolved to a blocked address.')
        return value

    async def download_heat_intelligence(self, activity_id: str) -> tuple[bytes, str]:
        status, link = await self.heat_intelligence_status(activity_id)
        if status.status == 'failed':
            raise FortyGuardAPIError(status.message or 'FortyGuard report generation failed.')
        if not status.ready or not link:
            raise FortyGuardAPIError('FortyGuard Heat Intelligence report is not ready yet.')
        safe_link = self._validate_download_link(link)
        try:
            async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
                response = await client.get(safe_link, headers={'Accept': 'application/pdf'})
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise FortyGuardAPIError('Unable to retrieve the completed FortyGuard report.') from exc
        content_type = response.headers.get('content-type', '').split(';', 1)[0].strip().lower()
        if content_type and content_type != 'application/pdf':
            raise FortyGuardAPIError('FortyGuard report download did not return a PDF.')
        if not response.content.startswith(b'%PDF'):
            raise FortyGuardAPIError('FortyGuard report payload is not a valid PDF document.')
        return response.content, 'application/pdf'

    async def usage(self) -> FortyGuardUsageSummary:
        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            return FortyGuardUsageSummary(
                dataStatus='configuration_required',
                message='FortyGuard API key is not configured.',
            )
        try:
            body = await self.fortyguard._request('POST', '/v1/system/fetch-api-key-usage', json={})
        except FortyGuardAPIError as exc:
            return FortyGuardUsageSummary(dataStatus='unavailable', message=str(exc))

        data = body.get('data') if isinstance(body.get('data'), dict) else body
        safe = _sanitized_usage_payload(data)
        plan = _deep_find(data, ('plan', 'plan_name', 'subscription_plan', 'tier'))
        monthly = _number(_deep_find(data, ('monthly_credits', 'credit_limit', 'credits_limit', 'total_credits')))
        used = _number(_deep_find(data, ('used_credits', 'credits_used', 'consumed_credits', 'usage_credits')))
        remaining = _number(_deep_find(data, ('remaining_credits', 'credits_remaining', 'available_credits')))
        reset = _deep_find(data, ('credits_reset_date', 'reset_date', 'renewal_date'))
        breakdown_raw = _deep_find(data, ('activity_breakdown', 'usage_breakdown', 'endpoint_breakdown', 'activities'))
        breakdown = _float_mapping(breakdown_raw)

        return FortyGuardUsageSummary(
            dataStatus='verified',
            plan=str(plan)[:120] if plan is not None else None,
            monthlyCredits=monthly,
            usedCredits=used,
            remainingCredits=remaining,
            creditsResetDate=str(reset)[:120] if reset is not None else None,
            activityBreakdown=breakdown,
            raw=safe if isinstance(safe, dict) else {'value': safe},
            message='FortyGuard billing-cycle credit usage retrieved without exposing the API key.',
        )
