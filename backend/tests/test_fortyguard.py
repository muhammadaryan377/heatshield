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
