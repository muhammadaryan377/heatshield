import asyncio
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from app.agriculture_schemas import AgricultureFieldCreate, AgricultureFieldHeatRequest
from app.core.config import Settings
from app.schemas import Coordinate, SiteCreate
from app.services.agriculture_field_heat import AgricultureFieldHeatService
from app.services.agriculture_fields import AgricultureFieldStore
from app.services.store import HeatShieldStore


def polygon_feature(value_key: str, value: float) -> dict:
    return {
        'type': 'Feature',
        'id': 'cell-1',
        'properties': {value_key: value},
        'geometry': {
            'type': 'Polygon',
            'coordinates': [[
                [55.27032, 25.20448],
                [55.27036, 25.20504],
                [55.27092, 25.20488],
                [55.27032, 25.20448],
            ]],
        },
    }


async def run() -> None:
    with TemporaryDirectory() as temporary_directory:
        database_path = str(Path(temporary_directory) / 'agriculture-fallback.db')
        settings = Settings(
            _env_file=None,
            database_path=database_path,
            fortyguard_api_key='ci-test-key',
            fortyguard_cache_ttl_seconds=0,
        )
        site_store = HeatShieldStore(settings)
        site = site_store.create_site(SiteCreate(
            name='Fallback Farm',
            address='Test farm',
            center=Coordinate(lat=25.2048, lng=55.2708),
            polygon=[
                Coordinate(lat=25.2040, lng=55.2700),
                Coordinate(lat=25.2054, lng=55.2701),
                Coordinate(lat=25.2050, lng=55.2715),
            ],
            zones=[],
        ))
        field_store = AgricultureFieldStore(settings)
        field = field_store.create_field(site.id, AgricultureFieldCreate(
            name='North Field',
            crop='Test crop',
            growthStage='Test stage',
            polygon=[
                Coordinate(lat=25.20448, lng=55.27032),
                Coordinate(lat=25.20504, lng=55.27036),
                Coordinate(lat=25.20488, lng=55.27092),
            ],
        ))

        service = AgricultureFieldHeatService(settings)
        calls: list[tuple[str, str]] = []
        tcm_attempts = 0

        async def fake_request_layer(*, polygon, study_date, granularity, analytic_type, threshold_c):
            nonlocal tcm_attempts
            del polygon, granularity, threshold_c
            calls.append((study_date, analytic_type))
            if analytic_type == 'tcm':
                tcm_attempts += 1
                if tcm_attempts == 1:
                    return 'activity-tcm-empty', {'map_data': {'features': []}}, None
                return 'activity-tcm-fallback', {
                    'map_data': {'features': [polygon_feature('average_temperature', 36.5)]},
                }, None
            if analytic_type == 'time_of_measure':
                return 'activity-peak', {
                    'map_data': {'features': [polygon_feature('value', 14.0)]},
                }, None
            if analytic_type == 'exceedance':
                return 'activity-exceedance', {
                    'map_data': {'features': [polygon_feature('value', 2.5)]},
                }, None
            return 'activity-persistence', {
                'map_data': {'features': [polygon_feature('value', 1.5)]},
            }, None

        service._request_layer = fake_request_layer  # type: ignore[method-assign]
        profile = await service.generate(
            site.id,
            field.id,
            AgricultureFieldHeatRequest(thresholdC=35, granularityMeters=100),
        )

        assert profile.dataStatus == 'verified'
        assert profile.maxTemperatureC == 36.5
        assert profile.maxHoursAboveThreshold == 2.5
        assert profile.maxPersistenceHours == 1.5
        assert profile.providerRequestCount == 5
        assert len(calls) == 5
        assert calls[0][1] == 'tcm' and calls[1][1] == 'tcm'
        assert date.fromisoformat(calls[1][0]) == date.fromisoformat(calls[0][0]) - timedelta(days=1)
        assert profile.date == calls[1][0]
        assert all(study_date == profile.date for study_date, analytic_type in calls[1:] if analytic_type != 'tcm')
        assert 'latest verified daily evidence' in (profile.message or '')

        print('Agriculture latest-verified field fallback smoke test passed')


if __name__ == '__main__':
    asyncio.run(run())
