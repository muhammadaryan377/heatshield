from datetime import date

from app.services.fortyguard_profile import (
    _local_hour_label,
    _tcm_average_temperature,
    _tcm_peak_temperature,
)


def _daily_tcm_feature() -> dict:
    return {
        'type': 'Feature',
        'properties': {
            'tile_id': 0,
            'average_temperature': 35.943,
            'min_temperature': 29.1602,
            'max_temperature': 40.4901,
        },
        'geometry': {'type': 'Polygon', 'coordinates': []},
    }


def test_daily_tcm_average_and_peak_are_not_conflated() -> None:
    feature = _daily_tcm_feature()

    assert _tcm_average_temperature(feature) == 35.943
    assert _tcm_peak_temperature(feature) == 40.4901


def test_single_hour_tcm_falls_back_cleanly() -> None:
    feature = {
        'properties': {
            'average_temperature': 35.3095,
            'max_temperature': 35.3095,
            'min_temperature': 35.3095,
        }
    }

    assert _tcm_average_temperature(feature) == 35.3095
    assert _tcm_peak_temperature(feature) == 35.3095


def test_time_of_measure_utc_hour_is_displayed_in_site_timezone() -> None:
    # FortyGuard documents time_of_measure as hour-of-day UTC. Phoenix is UTC-7
    # year-round, so 17:00 UTC is 10:00 AM local on this date.
    assert _local_hour_label(17, date(2024, 7, 15), 'America/Phoenix') == '10:00 AM'
