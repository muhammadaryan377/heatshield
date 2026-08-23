from datetime import datetime, timezone

from app.core.config import Settings
from app.schemas import Coordinate, Site
from app.services.fortyguard import FortyGuardClient


def _concave_phoenix_site() -> Site:
    # The stored display center is deliberately wrong/outside the AOI. This
    # reproduces a class of site-builder failures where a polygon is valid but
    # its simple display center cannot be used to sample a provider tile.
    return Site(
        id='phoenix-concave',
        name='Phoenix concave site',
        address='Phoenix, AZ, USA',
        center=Coordinate(lat=40.0, lng=-75.0),
        polygon=[
            Coordinate(lat=33.4440, lng=-112.0805),
            Coordinate(lat=33.4440, lng=-112.0665),
            Coordinate(lat=33.4555, lng=-112.0665),
            Coordinate(lat=33.4555, lng=-112.0730),
            Coordinate(lat=33.4490, lng=-112.0730),
            Coordinate(lat=33.4490, lng=-112.0805),
        ],
        zones=[],
        status='active',
    )


def test_analysis_coordinate_is_inside_saved_site_polygon() -> None:
    site = _concave_phoenix_site()
    coordinate = FortyGuardClient._analysis_coordinate(site)
    ring = [[point.lng, point.lat] for point in site.polygon]
    ring.append(ring[0])

    assert FortyGuardClient._point_in_ring(coordinate.lng, coordinate.lat, ring)
    assert coordinate != site.center


def test_site_timezone_comes_from_in_aoi_coordinate_not_bad_display_center() -> None:
    site = _concave_phoenix_site()
    timezone_name, _ = FortyGuardClient._site_timezone(site)

    assert timezone_name == 'America/Phoenix'


def test_current_hour_uses_phoenix_local_clock_even_when_saved_center_is_bad() -> None:
    client = FortyGuardClient(Settings(
        _env_file=None,
        fortyguard_api_key='test-key',
        fortyguard_recent_hour_fallbacks=1,
        fortyguard_cache_ttl_seconds=0,
    ))
    timezone_name, candidates = client._candidate_local_hours(
        _concave_phoenix_site(),
        datetime(2026, 8, 23, 11, 38, tzinfo=timezone.utc),
    )

    assert timezone_name == 'America/Phoenix'
    assert candidates[0].strftime('%Y-%m-%d %H:%M') == '2026-08-23 04:00'
    assert candidates[1].strftime('%Y-%m-%d %H:%M') == '2026-08-23 03:00'
