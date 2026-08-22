from __future__ import annotations

import asyncio
import json
from datetime import datetime, time, timedelta, timezone
from typing import Any

import httpx

from app.core.config import Settings
from app.schemas import (
    OperationalApproval,
    OperationalApprovalRequest,
    OperationalHeatPlan,
    OperationalPlannerOption,
    OperationalPlannerRequest,
    Site,
    SiteZone,
    Worker,
    WorkerOperationalDecision,
)
from app.services.fortyguard import FortyGuardAPIError, FortyGuardClient, FortyGuardConfigurationError
from app.services.nws import NWSAPIError, NWSClient
from app.services.store import HeatShieldStore


class OperationalHeatPlannerService:
    """Compare NOW vs BETTER TIME vs BETTER PLACE using shared FortyGuard scans.

    One site-wide heatmap is requested for NOW and for each requested future offset.
    Worker and approved-zone temperatures are spatial joins against those shared
    maps, so provider requests do not scale with worker count. The current
    FortyGuard scan is reused for environmental parameters instead of submitting
    another heatmap just to obtain heat-index context.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = HeatShieldStore(settings)
        self.fortyguard = FortyGuardClient(settings)
        self.nws = NWSClient(settings)

    @staticmethod
    def _features(result: dict[str, Any] | None) -> list[dict[str, Any]]:
        if not result:
            return []
        map_data = result.get('map_data')
        if not isinstance(map_data, dict):
            return []
        features = map_data.get('features')
        if not isinstance(features, list):
            return []
        return [item for item in features if isinstance(item, dict)]

    @staticmethod
    def _temperature(feature: dict[str, Any] | None) -> float | None:
        if not feature:
            return None
        props = feature.get('properties')
        if not isinstance(props, dict):
            return None
        for key in ('average_temperature', 'temperature', 'max_temperature'):
            value = props.get(key)
            if isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str):
                try:
                    return float(value)
                except ValueError:
                    continue
        return None

    @classmethod
    def _sample(cls, features: list[dict[str, Any]], lat: float, lng: float) -> float | None:
        for feature in features:
            geometry = feature.get('geometry')
            if isinstance(geometry, dict) and FortyGuardClient._geometry_contains_point(geometry, lng, lat):
                return cls._temperature(feature)
        return None

    @staticmethod
    def _parse_clock(value: str | None) -> time | None:
        if not value:
            return None
        cleaned = value.strip()
        for fmt in ('%H:%M', '%I:%M %p', '%I %p'):
            try:
                return datetime.strptime(cleaned, fmt).time()
            except ValueError:
                continue
        return None

    @classmethod
    def _inside_shift(cls, worker: Worker, target: datetime) -> bool:
        start = cls._parse_clock(worker.shiftStart)
        end = cls._parse_clock(worker.shiftEnd)
        if not start or not end:
            return True
        target_time = target.time().replace(second=0, microsecond=0)
        if start <= end:
            return start <= target_time <= end
        return target_time >= start or target_time <= end

    @staticmethod
    def _zone_allows_task(zone: SiteZone, worker: Worker) -> bool:
        if not zone.operationalApproved:
            return False
        task = (worker.task or worker.role).strip().casefold()
        allowed = {item.strip().casefold() for item in zone.allowedTasks if item.strip()}
        return '*' in allowed or task in allowed

    async def _scan(
        self,
        site: Site,
        target_local: datetime,
        granularity: int,
    ) -> tuple[list[dict[str, Any]], str | None, bool]:
        payload = {
            'polygon_aoi': self.fortyguard._geojson_polygon(site),
            'date_time': {
                'start_date': target_local.strftime('%Y-%m-%d'),
                'start_time': target_local.strftime('%H:00'),
                'filter_type': 1,
            },
            'granularity': granularity,
            'analytic_type': 'tcm',
        }
        try:
            activity_id = await self.fortyguard._submit('/v1/heatmap', payload)
            result = await self.fortyguard._wait(activity_id)
            features = self._features(result)
            if not any(self._temperature(feature) is not None for feature in features):
                return [], 'FortyGuard completed the scan but returned no usable temperature cells.', True
            return features, None, True
        except FortyGuardAPIError as exc:
            return [], str(exc), False

    async def _condition_context(
        self,
        site: Site,
        current_features: list[dict[str, Any]],
        current_target: datetime,
    ) -> tuple[float | None, str | None, int, str | None]:
        """Return heat index + source, reusing the current TCM scan when possible."""
        center_temperature = self._sample(current_features, site.center.lat, site.center.lng)
        if center_temperature is not None:
            payload = {
                'latitude': site.center.lat,
                'longitude': site.center.lng,
                'temperature': center_temperature,
                'date_time': {
                    'start_date': current_target.strftime('%Y-%m-%d'),
                    'start_time': current_target.strftime('%H:00'),
                    'filter_type': 1,
                },
            }
            try:
                activity_id = await self.fortyguard._submit('/v1/env_params', payload)
                result = await self.fortyguard._wait(activity_id)
                _, heat_index, _, _, _ = self.fortyguard._extract_environment(result)
                return heat_index, 'fortyguard', 1, None
            except FortyGuardAPIError as exc:
                provider_error = str(exc)
        else:
            provider_error = 'Current FortyGuard TCM scan did not contain the site center.'

        try:
            observation = await self.nws.fetch_observation(site=site)
            return observation.heat_index_c, 'nws', 0, provider_error
        except NWSAPIError as exc:
            return None, None, 0, f'{provider_error} NWS context also unavailable: {exc}'

    @staticmethod
    def _unavailable(kind: str, label: str, detail: str) -> OperationalPlannerOption:
        return OperationalPlannerOption(kind=kind, status='unavailable', label=label, detail=detail)

    @staticmethod
    def _verified_option(
        kind: str,
        label: str,
        temperature: float,
        baseline: float | None,
        sampled_at: datetime,
        detail: str,
        zone: SiteZone | None = None,
    ) -> OperationalPlannerOption:
        delta = None if baseline is None else round(temperature - baseline, 2)
        return OperationalPlannerOption(
            kind=kind,
            status='verified',
            label=label,
            temperatureC=round(temperature, 2),
            deltaC=delta,
            sampledAt=sampled_at.isoformat(),
            zoneId=zone.id if zone else None,
            zoneName=zone.name if zone else None,
            detail=detail,
        )

    async def _deepseek_explanations(
        self,
        site: Site,
        decisions: list[WorkerOperationalDecision],
    ) -> dict[str, tuple[str, str]]:
        if not self.settings.deepseek_configured or not decisions:
            return {}
        compact = []
        for item in decisions:
            compact.append({
                'workerId': item.workerId,
                'workerName': item.workerName,
                'role': item.role,
                'task': item.task,
                'recommendedChoice': item.recommendedChoice,
                'now': item.now.model_dump(),
                'betterTime': item.betterTime.model_dump(),
                'betterPlace': item.betterPlace.model_dump(),
                'workload': item.workload,
                'sunExposure': item.sunExposure,
                'heatIndexC': item.heatIndexC,
            })
        system = (
            'You are HeatShield operational planning assistant. The deterministic engine has already selected each recommendedChoice. '
            'Do not change choices, temperatures, times, zones, or invent evidence. Return a JSON object keyed by workerId. Each value '
            'must contain recommendation and rationale strings, concise enough for a supervisor. If evidence is limited, say so explicitly.'
        )
        try:
            async with httpx.AsyncClient(timeout=self.settings.deepseek_timeout_seconds) as client:
                response = await client.post(
                    f"{self.settings.deepseek_base_url.rstrip('/')}/chat/completions",
                    headers={
                        'Authorization': f'Bearer {self.settings.deepseek_api_key}',
                        'Content-Type': 'application/json',
                    },
                    json={
                        'model': self.settings.deepseek_model,
                        'temperature': 0.1,
                        'response_format': {'type': 'json_object'},
                        'messages': [
                            {'role': 'system', 'content': system},
                            {'role': 'user', 'content': json.dumps({'site': site.name, 'workers': compact})},
                        ],
                    },
                )
                response.raise_for_status()
                payload = response.json()
                content = payload['choices'][0]['message']['content']
                parsed = json.loads(content)
        except Exception:
            return {}

        output: dict[str, tuple[str, str]] = {}
        if not isinstance(parsed, dict):
            return output
        for worker_id, value in parsed.items():
            if not isinstance(worker_id, str) or not isinstance(value, dict):
                continue
            recommendation = value.get('recommendation')
            rationale = value.get('rationale')
            if isinstance(recommendation, str) and isinstance(rationale, str):
                output[worker_id] = (recommendation[:500], rationale[:700])
        return output

    async def generate(self, site_id: str, request: OperationalPlannerRequest) -> OperationalHeatPlan:
        site = self.store.get_site(site_id)
        workers = [worker for worker in self.store.list_workers(site_id) if worker.status != 'offsite']
        approved_zones = [zone for zone in site.zones if zone.operationalApproved]
        timezone_name, site_timezone = FortyGuardClient._site_timezone(site)
        now_utc = datetime.now(timezone.utc)
        local_now = now_utc.astimezone(site_timezone).replace(minute=0, second=0, microsecond=0)

        warnings: list[str] = []
        provider_request_count = 0

        try:
            _ = self.fortyguard.headers
            configured = True
        except FortyGuardConfigurationError:
            configured = False
            warnings.append('FortyGuard is not configured, so NOW / BETTER TIME / BETTER PLACE cannot be verified.')

        offsets = [0, *request.offsetsHours]
        scans: dict[int, tuple[datetime, list[dict[str, Any]], str | None]] = {}
        if configured:
            async def run_offset(offset: int):
                target = local_now + timedelta(hours=offset)
                features, error, submitted = await self._scan(site, target, request.granularityMeters)
                return offset, target, features, error, submitted

            results = await asyncio.gather(*(run_offset(offset) for offset in offsets))
            for offset, target, features, error, submitted in results:
                if submitted:
                    provider_request_count += 1
                scans[offset] = (target, features, error)
                if error:
                    warnings.append(f'{target.strftime("%b %d, %I:%M %p")}: {error}')
        else:
            for offset in offsets:
                target = local_now + timedelta(hours=offset)
                scans[offset] = (target, [], 'FortyGuard not configured')

        current_target, current_features, current_error = scans[0]
        if configured:
            heat_index, condition_source, environment_jobs, environment_warning = await self._condition_context(site, current_features, current_target)
            provider_request_count += environment_jobs
            if environment_warning:
                warnings.append(environment_warning)
        else:
            try:
                observation = await self.nws.fetch_observation(site=site)
                heat_index = observation.heat_index_c
                condition_source = 'nws'
            except NWSAPIError:
                heat_index = None
                condition_source = None

        decisions: list[WorkerOperationalDecision] = []
        for worker in workers:
            task_name = (worker.task or worker.role).strip()
            current_temp = self._sample(current_features, worker.coordinate.lat, worker.coordinate.lng)
            if current_temp is None:
                now_option = self._unavailable('now', 'NOW', current_error or 'No FortyGuard cell contains the worker coordinate for the current scan.')
            else:
                now_option = self._verified_option(
                    'now', 'NOW', current_temp, current_temp, current_target,
                    f'Worker coordinate is inside a verified FortyGuard thermal cell at {current_target.strftime("%I:%M %p")}.'
                )

            future_candidates: list[OperationalPlannerOption] = []
            for offset in request.offsetsHours:
                target, features, _ = scans[offset]
                if not self._inside_shift(worker, target):
                    continue
                sampled_temperature = self._sample(features, worker.coordinate.lat, worker.coordinate.lng)
                if sampled_temperature is None:
                    continue
                future_candidates.append(self._verified_option(
                    'better_time', f'+{offset}h', sampled_temperature, current_temp, target,
                    f'Same worker location sampled by FortyGuard {offset} hour(s) from the current planning hour.'
                ))

            if future_candidates:
                best_future = min(future_candidates, key=lambda item: item.temperatureC if item.temperatureC is not None else float('inf'))
                if current_temp is not None and best_future.temperatureC is not None and current_temp - best_future.temperatureC >= request.minImprovementC:
                    better_time = best_future
                else:
                    better_time = OperationalPlannerOption(
                        kind='better_time', status='not_applicable', label='BETTER TIME',
                        temperatureC=best_future.temperatureC, deltaC=best_future.deltaC, sampledAt=best_future.sampledAt,
                        detail=f'No in-shift future sample improves thermal exposure by at least {request.minImprovementC:.1f}°C.'
                    )
            else:
                better_time = self._unavailable('better_time', 'BETTER TIME', 'No usable in-shift future FortyGuard sample was returned.')

            zone_candidates: list[OperationalPlannerOption] = []
            eligible_zones = [zone for zone in approved_zones if self._zone_allows_task(zone, worker) and zone.id != worker.locationId]
            for zone in eligible_zones:
                zone_temperature = self._sample(current_features, zone.center.lat, zone.center.lng)
                if zone_temperature is None:
                    continue
                zone_candidates.append(self._verified_option(
                    'better_place', zone.name, zone_temperature, current_temp, current_target,
                    f'Approved zone center is inside a verified FortyGuard cell and explicitly allows {task_name}.', zone,
                ))

            if zone_candidates:
                best_zone = min(zone_candidates, key=lambda item: item.temperatureC if item.temperatureC is not None else float('inf'))
                if current_temp is not None and best_zone.temperatureC is not None and current_temp - best_zone.temperatureC >= request.minImprovementC:
                    better_place = best_zone
                else:
                    better_place = OperationalPlannerOption(
                        kind='better_place', status='not_applicable', label='BETTER PLACE',
                        temperatureC=best_zone.temperatureC, deltaC=best_zone.deltaC, sampledAt=best_zone.sampledAt,
                        zoneId=best_zone.zoneId, zoneName=best_zone.zoneName,
                        detail=f'Approved task-compatible zones do not improve thermal exposure by at least {request.minImprovementC:.1f}°C.'
                    )
            elif not eligible_zones:
                better_place = OperationalPlannerOption(
                    kind='better_place', status='not_applicable', label='BETTER PLACE',
                    detail='No other supervisor-approved zone explicitly allows this worker task.'
                )
            else:
                better_place = self._unavailable('better_place', 'BETTER PLACE', 'Approved zones exist, but no current FortyGuard cells matched their centers.')

            verified_improvements: list[tuple[str, float]] = []
            if better_time.status == 'verified' and better_time.deltaC is not None and better_time.deltaC < 0:
                verified_improvements.append(('better_time', -better_time.deltaC))
            if better_place.status == 'verified' and better_place.deltaC is not None and better_place.deltaC < 0:
                verified_improvements.append(('better_place', -better_place.deltaC))

            if current_temp is None:
                choice = 'review'
                recommendation = 'Review manually — current worker tile is not verified by FortyGuard.'
                rationale = 'HeatShield will not compare unverified temperatures or invent a spatial baseline.'
            elif verified_improvements:
                choice, improvement = max(verified_improvements, key=lambda item: item[1])
                if choice == 'better_time':
                    recommendation = f'Consider shifting this task to {datetime.fromisoformat(better_time.sampledAt).strftime("%I:%M %p")}.' if better_time.sampledAt else 'Consider the verified cooler time window.'
                    rationale = f'FortyGuard samples show approximately {improvement:.1f}°C lower temperature at the same worker location.'
                else:
                    recommendation = f'Consider equivalent approved work in {better_place.zoneName}.'
                    rationale = f'FortyGuard samples show approximately {improvement:.1f}°C lower temperature at the approved zone center.'
            else:
                choice = 'now'
                recommendation = 'No verified cooler alternative meets the configured improvement threshold; keep the current assignment with heat controls.'
                rationale = 'Available future and approved-zone samples do not provide a materially cooler verified option.'

            evidence_warnings: list[str] = []
            if heat_index is None:
                evidence_warnings.append('No verified heat-index context is available.')
            if not approved_zones:
                evidence_warnings.append('No approved operational zones are configured.')
            if better_time.status == 'unavailable':
                evidence_warnings.append('Future FortyGuard evidence is incomplete.')

            decisions.append(WorkerOperationalDecision(
                workerId=worker.id,
                workerName=worker.name,
                role=worker.role,
                task=task_name,
                currentArea=worker.location,
                workload=worker.workIntensity,
                sunExposure=worker.sunExposure,
                heatIndexC=heat_index,
                now=now_option,
                betterTime=better_time,
                betterPlace=better_place,
                recommendedChoice=choice,
                recommendation=recommendation,
                rationale=rationale,
                evidenceWarnings=evidence_warnings,
            ))

        explanations = await self._deepseek_explanations(site, decisions)
        if explanations:
            decisions = [
                item.model_copy(update={'recommendation': explanations[item.workerId][0], 'rationale': explanations[item.workerId][1]})
                if item.workerId in explanations else item
                for item in decisions
            ]

        if not workers:
            warnings.append('No active workers are assigned to this site.')
        if not approved_zones:
            warnings.append('Add supervisor-approved operational zones to enable BETTER PLACE comparisons.')

        return OperationalHeatPlan(
            site=site,
            generatedAt=now_utc.isoformat(),
            timezoneName=timezone_name,
            agentMode='deepseek_assisted' if explanations else 'deterministic',
            conditionSource=condition_source,
            conditionHeatIndexC=heat_index,
            providerRequestCount=provider_request_count,
            offsetsHours=request.offsetsHours,
            approvedZoneCount=len(approved_zones),
            workers=decisions,
            warnings=list(dict.fromkeys(warnings)),
        )

    async def approve(self, site_id: str, payload: OperationalApprovalRequest) -> OperationalApproval:
        return self.store.create_operational_approval(site_id, payload)

    async def verify(self, site_id: str, approval_id: str) -> OperationalApproval:
        approval = self.store.get_operational_approval(site_id, approval_id)
        site = self.store.get_site(site_id)
        worker = self.store.get_worker(site_id, approval.workerId)
        timezone_name, site_timezone = FortyGuardClient._site_timezone(site)
        now = datetime.now(timezone.utc)
        local_now = now.astimezone(site_timezone).replace(minute=0, second=0, microsecond=0)

        if approval.targetTime:
            try:
                target = datetime.fromisoformat(approval.targetTime)
                if target.tzinfo is None:
                    target = target.replace(tzinfo=site_timezone)
                if now < target.astimezone(timezone.utc):
                    return approval.model_copy(update={
                        'verificationMessage': f'Target window has not arrived yet ({target.astimezone(site_timezone).strftime("%b %d, %I:%M %p")}).'
                    })
            except ValueError:
                pass

        coordinate = worker.coordinate
        if approval.choice == 'better_place' and approval.targetZoneId:
            zone = next((item for item in site.zones if item.id == approval.targetZoneId and item.operationalApproved), None)
            if zone is None:
                return self.store.update_operational_verification(
                    site_id, approval_id, status='verification_unavailable', verified_temperature_c=None,
                    actual_reduction_c=None, message='The approved target zone no longer exists or is no longer approved.'
                )
            coordinate = zone.center

        try:
            _ = self.fortyguard.headers
        except FortyGuardConfigurationError:
            return self.store.update_operational_verification(
                site_id, approval_id, status='verification_unavailable', verified_temperature_c=None,
                actual_reduction_c=None, message='FortyGuard is not configured, so fresh verification cannot run.'
            )

        features, error, _ = await self._scan(site, local_now, 100)
        verified = self._sample(features, coordinate.lat, coordinate.lng)
        if verified is None:
            return self.store.update_operational_verification(
                site_id, approval_id, status='verification_unavailable', verified_temperature_c=None,
                actual_reduction_c=None, message=error or f'FortyGuard returned no usable cell for fresh verification in {timezone_name}.'
            )

        actual_reduction = None
        if approval.baselineTemperatureC is not None:
            actual_reduction = round(approval.baselineTemperatureC - verified, 2)
        message = 'Fresh FortyGuard verification completed.'
        if actual_reduction is not None:
            message += f' Observed reduction versus the original baseline: {actual_reduction:.1f}°C.'
        return self.store.update_operational_verification(
            site_id, approval_id, status='verified', verified_temperature_c=round(verified, 2),
            actual_reduction_c=actual_reduction, message=message,
        )
