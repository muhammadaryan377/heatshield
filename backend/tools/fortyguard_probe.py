from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

# Allow this file to be run directly from backend/ with:
#   python tools/fortyguard_probe.py
# Python otherwise puts backend/tools (not backend/) on sys.path, so `app`
# cannot be imported even though the project is correctly laid out.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import httpx

from app.core.config import get_settings


NYC_DOCS_POLYGON = [
    [-74.0170, 40.7050],
    [-74.0030, 40.7050],
    [-74.0030, 40.7180],
    [-74.0170, 40.7180],
    [-74.0170, 40.7050],
]

# Small, unambiguous downtown Phoenix, Arizona AOI. This avoids ambiguous place-name geocoding.
PHOENIX_AZ_POLYGON = [
    [-112.0805, 33.4440],
    [-112.0665, 33.4440],
    [-112.0665, 33.4555],
    [-112.0805, 33.4555],
    [-112.0805, 33.4440],
]

PHOENIX_CENTER = {"latitude": 33.44975, "longitude": -112.0735}


def feature_collection(ring: list[list[float]]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        ],
    }


def number(value: Any) -> float | None:
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


def summarize_heatmap_result(result: dict[str, Any], analytic_type: str) -> dict[str, Any]:
    map_data = result.get("map_data") if isinstance(result.get("map_data"), dict) else {}
    features = map_data.get("features") if isinstance(map_data.get("features"), list) else []
    stats = result.get("stats_data") if isinstance(result.get("stats_data"), dict) else {}

    sample_props: dict[str, Any] = {}
    sample_geometry_type: str | None = None
    if features and isinstance(features[0], dict):
        sample_props = features[0].get("properties") if isinstance(features[0].get("properties"), dict) else {}
        geometry = features[0].get("geometry") if isinstance(features[0].get("geometry"), dict) else {}
        sample_geometry_type = geometry.get("type") if isinstance(geometry.get("type"), str) else None

    values: list[float] = []
    peak_values: list[float] = []
    min_values: list[float] = []
    if analytic_type == "tcm":
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            average = number(props.get("average_temperature"))
            if average is None:
                average = number(props.get("temperature"))
            peak = number(props.get("max_temperature"))
            minimum = number(props.get("min_temperature"))
            if average is not None:
                values.append(average)
            if peak is not None:
                peak_values.append(peak)
            if minimum is not None:
                min_values.append(minimum)
    else:
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            value = number(props.get("value"))
            if value is not None:
                values.append(value)

    summary: dict[str, Any] = {
        "feature_count": len(features),
        "usable_value_count": len(values),
        "map_type": map_data.get("type"),
        "sample_geometry_type": sample_geometry_type,
        "sample_property_keys": sorted(sample_props.keys()),
        "sample_properties": {key: sample_props.get(key) for key in sorted(sample_props.keys())[:20]},
        "stats_keys": sorted(stats.keys()),
        "stats_data": stats,
    }
    if values:
        summary["value_min"] = min(values)
        summary["value_mean"] = sum(values) / len(values)
        summary["value_max"] = max(values)
    if analytic_type == "tcm" and peak_values:
        summary["peak_temperature_min"] = min(peak_values)
        summary["peak_temperature_mean"] = sum(peak_values) / len(peak_values)
        summary["peak_temperature_max"] = max(peak_values)
    if analytic_type == "tcm" and min_values:
        summary["minimum_temperature_min"] = min(min_values)
        summary["minimum_temperature_mean"] = sum(min_values) / len(min_values)
        summary["minimum_temperature_max"] = max(min_values)
    return summary


def summarize_environment(result: dict[str, Any]) -> dict[str, Any]:
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    locations = result.get("locations") if isinstance(result.get("locations"), list) else []
    first = locations[0] if locations and isinstance(locations[0], dict) else {}
    params = first.get("parameters") if isinstance(first.get("parameters"), dict) else {}

    first_values: dict[str, Any] = {}
    for key, value in params.items():
        if isinstance(value, list):
            first_values[key] = value[0] if value else None
        else:
            first_values[key] = value

    return {
        "metadata": metadata,
        "location": {key: first.get(key) for key in ("lat", "lon", "elevation", "temperature") if key in first},
        "parameter_keys": sorted(params.keys()),
        "first_parameter_values": first_values,
        "solar_irradiance": first.get("solar_irradiance"),
    }


class FortyGuardProbe:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.fortyguard_configured:
            raise RuntimeError(
                "FORTYGUARD_API_KEY is not configured in backend/.env. "
                "Do not paste the key into chat; configure it locally and rerun this probe."
            )
        self.base_url = settings.fortyguard_base_url.rstrip("/")
        self.headers = {"api-key": settings.fortyguard_api_key.strip(), "Content-Type": "application/json"}
        self.timeout = max(30.0, settings.fortyguard_timeout_seconds)
        self.poll_interval = max(1.0, settings.fortyguard_poll_interval_seconds)
        self.max_polls = max(10, settings.fortyguard_max_poll_attempts)

    async def _submit_and_wait(self, path: str, payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(f"{self.base_url}{path}", headers=self.headers, json=payload)
            try:
                body = response.json()
            except Exception:
                body = {"raw_text": response.text}

            submission = {
                "http_status": response.status_code,
                "message": body.get("message") if isinstance(body, dict) else None,
                "error": body.get("error") if isinstance(body, dict) else None,
            }
            if response.status_code >= 400:
                submission["response"] = body
                return submission, None

            data = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), dict) else {}
            activity_id = data.get("activity_id")
            submission["activity_id"] = activity_id
            if not activity_id:
                submission["response"] = body
                return submission, None

            for poll_number in range(1, self.max_polls + 1):
                status_response = await client.get(
                    f"{self.base_url}/v1/status/{activity_id}", headers=self.headers
                )
                try:
                    status_body = status_response.json()
                except Exception:
                    status_body = {"raw_text": status_response.text}
                status_data = (
                    status_body.get("data")
                    if isinstance(status_body, dict) and isinstance(status_body.get("data"), dict)
                    else {}
                )
                status = str(status_data.get("status") or "").lower()
                if status in {"completed", "succeeded"}:
                    submission["polls"] = poll_number
                    submission["final_status"] = status_data.get("status")
                    result = status_data.get("result") if isinstance(status_data.get("result"), dict) else {}
                    return submission, result
                if status in {"failed", "error"}:
                    submission["polls"] = poll_number
                    submission["final_status"] = status_data.get("status")
                    submission["status_response"] = status_body
                    return submission, None
                await asyncio.sleep(self.poll_interval)

            submission["final_status"] = "timeout"
            return submission, None

    async def heatmap(
        self,
        *,
        name: str,
        ring: list[list[float]],
        date_time: dict[str, Any],
        analytic_type: str = "tcm",
        threshold: float | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "polygon_aoi": feature_collection(ring),
            "date_time": date_time,
            "granularity": 100,
            "analytic_type": analytic_type,
        }
        if analytic_type in {"exceedance", "persistence"}:
            payload["threshold"] = 30.0 if threshold is None else threshold
            payload["direction"] = "above"

        print(f"\n=== {name} ===")
        print(json.dumps(payload, indent=2))
        submission, result = await self._submit_and_wait("/v1/heatmap", payload)
        report: dict[str, Any] = {"name": name, "payload": payload, "submission": submission}
        if result is not None:
            report["result_summary"] = summarize_heatmap_result(result, analytic_type)
        print(json.dumps({"submission": submission, "result_summary": report.get("result_summary")}, indent=2))
        return report

    async def environment(self, *, temperature_c: float) -> dict[str, Any]:
        payload = {
            **PHOENIX_CENTER,
            "temperature": temperature_c,
            "date_time": {"start_date": "2024-07-15", "start_time": "14:00", "filter_type": 1},
        }
        print("\n=== phoenix_env_params_2024_07_15_14 ===")
        print(json.dumps(payload, indent=2))
        submission, result = await self._submit_and_wait("/v1/env_params", payload)
        report: dict[str, Any] = {
            "name": "phoenix_env_params_2024_07_15_14",
            "payload": payload,
            "submission": submission,
        }
        if result is not None:
            report["result_summary"] = summarize_environment(result)
        print(json.dumps({"submission": submission, "result_summary": report.get("result_summary")}, indent=2))
        return report


async def run(include_live: bool, full: bool) -> None:
    probe = FortyGuardProbe()
    report: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_url": probe.base_url,
        "tests": [],
    }

    report["tests"].append(
        await probe.heatmap(
            name="official_docs_nyc_single_hour_tcm",
            ring=NYC_DOCS_POLYGON,
            date_time={"start_date": "2024-07-15", "start_time": "14:00", "filter_type": 1},
        )
    )

    phoenix_tcm = await probe.heatmap(
        name="phoenix_az_single_hour_tcm",
        ring=PHOENIX_AZ_POLYGON,
        date_time={"start_date": "2024-07-15", "start_time": "14:00", "filter_type": 1},
    )
    report["tests"].append(phoenix_tcm)

    phoenix_summary = phoenix_tcm.get("result_summary") or {}
    phoenix_temperature = number(phoenix_summary.get("value_mean"))
    if phoenix_temperature is not None:
        report["tests"].append(await probe.environment(temperature_c=phoenix_temperature))

    if full:
        for analytic_type in ("tcm", "time_of_measure", "exceedance", "persistence"):
            report["tests"].append(
                await probe.heatmap(
                    name=f"phoenix_az_single_day_{analytic_type}",
                    ring=PHOENIX_AZ_POLYGON,
                    date_time={"start_date": "2024-07-15", "filter_type": 3},
                    analytic_type=analytic_type,
                    threshold=30.0,
                )
            )

        report["tests"].append(
            await probe.heatmap(
                name="phoenix_az_range_days_filter4_compatibility",
                ring=PHOENIX_AZ_POLYGON,
                date_time={
                    "start_date": "2024-07-15",
                    "end_date": "2024-07-21",
                    "filter_type": 4,
                },
                analytic_type="exceedance",
                threshold=30.0,
            )
        )

    if include_live:
        phoenix_tz = ZoneInfo("America/Phoenix")
        now_utc = datetime.now(timezone.utc)
        now_local = now_utc.astimezone(phoenix_tz).replace(minute=0, second=0, microsecond=0)
        utc_hour = now_utc.replace(minute=0, second=0, microsecond=0)

        report["tests"].append(
            await probe.heatmap(
                name="phoenix_az_live_using_local_clock",
                ring=PHOENIX_AZ_POLYGON,
                date_time={
                    "start_date": now_local.date().isoformat(),
                    "start_time": now_local.strftime("%H:%M"),
                    "filter_type": 1,
                },
            )
        )
        report["tests"].append(
            await probe.heatmap(
                name="phoenix_az_live_using_utc_clock",
                ring=PHOENIX_AZ_POLYGON,
                date_time={
                    "start_date": utc_hour.date().isoformat(),
                    "start_time": utc_hour.strftime("%H:%M"),
                    "filter_type": 1,
                },
            )
        )

    output = BACKEND_ROOT / "fortyguard_probe_report.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nSaved sanitized probe report to: {output}")
    print("The API key is never written to the report.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run controlled FortyGuard USA API probes without touching HeatShield product data.")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Also test single-day TCM/time-of-measure/exceedance/persistence and filter_type=4 compatibility.",
    )
    parser.add_argument(
        "--include-live",
        action="store_true",
        help="Also test the current Phoenix hour using both AOI-local and UTC clock interpretations.",
    )
    args = parser.parse_args()
    asyncio.run(run(include_live=args.include_live, full=args.full))


if __name__ == "__main__":
    main()
