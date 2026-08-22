import asyncio
from datetime import datetime, timezone

from app.core.config import Settings
from app.schemas import Coordinate, Site
from app.services.fortyguard import FortyGuardClient


def _site() -> Site:
    return Site(
        id='site-a',
        name='Test site',
        address='Test address',
        center=Coordinate(lat=1.0, lng=1.0),
        polygon=[
            Coordinate(lat=0.5, lng=0.5),
            Coordinate(lat=0.5, lng=1.5),
            Coordinate(lat=1.5, lng=1.5),
        ],
        zones=[],
        status='active',
    )


def _florida_site() -> Site:
    return Site(
        id='site-florida',
        name='Florida test site',
        address='Florida',
        center=Coordinate(lat=27.60460497582901, lng=-81.51024509095762),
        polygon=[
            Coordinate(lat=27.60612618257304, lng=-81.5142040314636),
            Coordinate(lat=27.60289361841731, lng=-81.51416111611937),
            Coordinate(lat=27.60308377188977, lng=-81.50622177743529),
            Coordinate(lat=27.606316330435916, lng=-81.50639343881224),
        ],
        zones=[],
        status='active',
    )


def test_extracts_numeric_string_from_multipolygon() -> None:
    result = {
        'map_data': {
            'features': [{
                'type': 'Feature',
                'properties': {'average_temperature': '39.25'},
                'geometry': {
                    'type': 'MultiPolygon',
                    'coordinates': [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]],
                },
            }],
        },
    }

    temperature, _ = FortyGuardClient._extract_temperature(result, _site())

    assert temperature == 39.25


def test_tile_boundary_counts_as_contained() -> None:
    assert FortyGuardClient._point_in_ring(
        1.0, 0.0, [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]
    )


def test_florida_site_uses_eastern_local_whole_hour() -> None:
    settings = Settings(
        _env_file=None,
        fortyguard_api_key='test-key',
        fortyguard_recent_hour_fallbacks=2,
        fortyguard_cache_ttl_seconds=0,
    )
    client = FortyGuardClient(settings)
    timezone_name, candidates = client._candidate_local_hours(
        _florida_site(),
        datetime(2026, 8, 22, 12, 44, tzinfo=timezone.utc),
    )

    assert timezone_name == 'America/New_York'
    assert candidates[0].strftime('%Y-%m-%d %H:%M') == '2026-08-22 08:00'
    assert candidates[1].strftime('%Y-%m-%d %H:%M') == '2026-08-22 07:00'


def test_zero_tile_current_hour_falls_back_and_reuses_matched_time_for_environment() -> None:
    settings = Settings(
        _env_file=None,
        fortyguard_api_key='test-key',
        fortyguard_recent_hour_fallbacks=2,
        fortyguard_cache_ttl_seconds=0,
    )
    client = FortyGuardClient(settings)
    site = _florida_site()
    submitted: list[tuple[str, dict]] = []
    heatmap_count = 0

    async def fake_submit(endpoint: str, payload: dict) -> str:
        nonlocal heatmap_count
        submitted.append((endpoint, payload))
        if endpoint == '/v1/heatmap':
            heatmap_count += 1
            return f'heatmap-{heatmap_count}'
        return 'environment-1'

    async def fake_wait(activity_id: str) -> dict:
        if activity_id == 'heatmap-1':
            return {'map_data': {'type': 'FeatureCollection', 'features': []}, 'stats_data': {}}
        if activity_id == 'heatmap-2':
            return {
                'map_data': {
                    'type': 'FeatureCollection',
                    'features': [{
                        'type': 'Feature',
                        'properties': {'average_temperature': 33.4},
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [[
                                [-81.515, 27.602],
                                [-81.505, 27.602],
                                [-81.505, 27.607],
                                [-81.515, 27.607],
                                [-81.515, 27.602],
                            ]],
                        },
                    }],
                },
                'stats_data': {'temperature_stats': {'mean': 33.4}},
            }
        return {
            'locations': [{
                'parameters': {
                    'heat_index_celsius': [36.8],
                    'apparent_temperature_celsius': [35.1],
                    'relative_humidity_percent': [58.0],
                },
            }],
            'metadata': {'timestamps': ['2026-08-22T07:00:00-04:00']},
        }

    client._submit = fake_submit  # type: ignore[method-assign]
    client._wait = fake_wait  # type: ignore[method-assign]

    observation = asyncio.run(client.fetch_observation(
        site=site,
        now_utc=datetime(2026, 8, 22, 12, 44, tzinfo=timezone.utc),
    ))

    assert submitted[0][1]['date_time']['start_time'] == '08:00'
    assert submitted[1][1]['date_time']['start_time'] == '07:00'
    assert submitted[2][0] == '/v1/env_params'
    assert submitted[2][1]['date_time'] == submitted[1][1]['date_time']
    assert observation.temperature_c == 33.4
    assert observation.heat_index_c == 36.8
    assert observation.source_age_hours == 1
    assert observation.observed_at == '2026-08-22T07:00:00-04:00'
