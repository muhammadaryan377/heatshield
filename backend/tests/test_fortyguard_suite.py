from datetime import datetime, timedelta, timezone

from app.services.fortyguard_suite import (
    _REPORT_CACHE,
    _data_url,
    _number,
    _segments,
    get_cached_heat_intelligence_report,
)


def test_data_url_preserves_existing_data_uri_and_wraps_base64():
    assert _data_url('data:image/png;base64,abc') == 'data:image/png;base64,abc'
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


def test_report_cache_expires_old_pdf():
    now = datetime.now(timezone.utc)
    _REPORT_CACHE['fresh'] = (now, b'%PDF-fresh')
    _REPORT_CACHE['old'] = (now - timedelta(hours=1), b'%PDF-old')
    assert get_cached_heat_intelligence_report('fresh') == b'%PDF-fresh'
    assert get_cached_heat_intelligence_report('old') is None
