from datetime import datetime, timezone

from app.schemas import Coordinate
from app.services.urban_before_after import (
    _local_clock_difference_minutes,
    _point_in_polygon,
)


def test_local_clock_difference_wraps_midnight() -> None:
    before = datetime(2026, 8, 1, 23, 30, tzinfo=timezone.utc)
    after = datetime(2026, 8, 2, 0, 15, tzinfo=timezone.utc)

    assert _local_clock_difference_minutes(before, after) == 45


def test_local_clock_difference_uses_clock_time_not_date_gap() -> None:
    before = datetime(2026, 7, 1, 14, 0, tzinfo=timezone.utc)
    after = datetime(2026, 8, 20, 14, 50, tzinfo=timezone.utc)

    assert _local_clock_difference_minutes(before, after) == 50


def test_locked_target_on_tile_edge_counts_as_spatial_match() -> None:
    polygon = [
        Coordinate(lat=0.0, lng=0.0),
        Coordinate(lat=0.0, lng=1.0),
        Coordinate(lat=1.0, lng=1.0),
        Coordinate(lat=1.0, lng=0.0),
    ]

    assert _point_in_polygon(Coordinate(lat=0.5, lng=1.0), polygon)
    assert not _point_in_polygon(Coordinate(lat=1.5, lng=1.5), polygon)
