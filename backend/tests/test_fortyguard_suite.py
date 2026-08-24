from datetime import datetime, timedelta, timezone

from app.services.fortyguard_suite import (
    _REPORT_CACHE,
    _data_url,
    _heatmap_statistics,
    _number,
    _segments,
    get_cached_heat_intelligence_report,
)


def test_data_url_preserves_existing_data_uri_and_wraps_base64():
    assert _data_url('data:image/png;base64,abc') == 'data:image/png;base64,abc'
    assert _data_url('https://example.com/image.png') == 'https://example.com/image.png'
    assert _data_url('abc') == 'data:image/png;base64,abc'
    assert _data_url(None) is None


def test_environment_number_rejects_provider_sentinel():
    assert _number('-9999') is None
    assert _number([31.4]) == 31.4
    assert _number('42.7') == 42.7


def test_segments_keep_only_numeric_coverage():
    assert _segments({'vegetation': 32.5, 'building': '40.0', 'bad': 'n/a'}) == {
        'vegetation': 32.5,
        'building': 40.0,
    }


def test_map_statistics_accept_documented_provider_casing():
    std_dev, distribution, normal, frequency = _heatmap_statistics({
        'heatmap_stats': {
            'Temperature_stats': {
                'Minimum': 25.0,
                'Maximum': 33.0,
                'Mean': 29.0,
                'Standard_deviation': 1.8,
            },
            'Overall_temperature_distribution': [25, '29.5', 33],
            'Normal_temperature_distribution': {'x_axis': [25, 29, 33], 'y_axis': [0.1, 0.3, 0.1]},
            'Temperature_frequency': {'25-27': 4, '28-30': 10},
        }
    })
    assert std_dev == 1.8
    assert distribution == [25.0, 29.5, 33.0]
    assert normal['x_axis'] == [25, 29, 33]
    assert frequency['28-30'] == 10


def test_report_cache_expires_old_pdf():
    now = datetime.now(timezone.utc)
    _REPORT_CACHE['fresh'] = (now, b'%PDF-fresh')
    _REPORT_CACHE['old'] = (now - timedelta(hours=1), b'%PDF-old')
    assert get_cached_heat_intelligence_report('fresh') == b'%PDF-fresh'
    assert get_cached_heat_intelligence_report('old') is None
