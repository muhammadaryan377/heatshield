from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.services.store import HeatShieldStore

router = APIRouter(prefix='/api/platform', tags=['platform'])


def store(settings: Settings = Depends(get_settings)) -> HeatShieldStore:
    return HeatShieldStore(settings)


@router.get('/readiness')
async def platform_readiness(
    settings: Settings = Depends(get_settings),
    db: HeatShieldStore = Depends(store),
) -> dict[str, object]:
    """Return non-secret product readiness and workspace coverage diagnostics.

    This endpoint deliberately reports configuration and workspace state only. It
    never returns API keys and it does not spend provider credits on a health
    probe. Live provider availability remains visible on evidence-producing
    endpoints where it can be tied to an actual site and timestamp.
    """
    sites = db.list_sites()
    active_sites = [site for site in sites if site.status == 'active']
    boundary_ready_sites = [site for site in active_sites if len(site.polygon) >= 3]

    workers_by_site: dict[str, int] = {}
    worker_count = 0
    for site in sites:
        try:
            count = len(db.list_workers(site.id))
        except FileNotFoundError:
            count = 0
        workers_by_site[site.id] = count
        worker_count += count

    zone_count = sum(len(site.zones) for site in sites)
    approved_zone_count = sum(
        1
        for site in sites
        for zone in site.zones
        if zone.operationalApproved
    )

    warnings: list[str] = []
    if not settings.fortyguard_configured:
        warnings.append('Configure FortyGuard before relying on spatial thermal intelligence.')
    if settings.heatshield_use_fixtures:
        warnings.append('Fixtures are enabled. Disable fixtures before a production or judged demo.')
    if not sites:
        warnings.append('Create at least one real site boundary to unlock operational workflows.')
    elif not boundary_ready_sites:
        warnings.append('No active site currently has a valid analysis boundary.')
    if sites and worker_count == 0:
        warnings.append('Add workers to unlock person-level Workforce Safety decisions.')
    if sites and approved_zone_count == 0:
        warnings.append('Add approved operational zones to unlock better-place planning decisions.')

    def module_state(module: str) -> dict[str, object]:
        if not settings.fortyguard_configured:
            return {
                'status': 'configure_provider',
                'ready': False,
                'detail': 'FortyGuard configuration is required for verified spatial heat evidence.',
            }
        if not boundary_ready_sites:
            return {
                'status': 'add_site',
                'ready': False,
                'detail': 'Create an active site boundary before running heat intelligence.',
            }
        if module == 'workforce' and worker_count == 0:
            return {
                'status': 'add_workers',
                'ready': False,
                'detail': 'Site intelligence is available; add workers for person-level decisions.',
            }
        return {
            'status': 'ready',
            'ready': True,
            'detail': 'Core evidence prerequisites are configured. Individual requests still report provider availability and freshness.',
        }

    module_readiness = {
        'workforce': module_state('workforce'),
        'enterprise': module_state('enterprise'),
        'agriculture': module_state('agriculture'),
        'urban': module_state('urban'),
    }

    score = 0
    if settings.fortyguard_configured:
        score += 35
    if not settings.heatshield_use_fixtures:
        score += 15
    if boundary_ready_sites:
        score += 25
    if worker_count:
        score += 10
    if approved_zone_count:
        score += 10
    if settings.deepseek_configured:
        score += 5

    return {
        'environment': settings.app_env,
        'readinessScore': score,
        'productionSafeDataMode': not settings.heatshield_use_fixtures,
        'providers': {
            'fortyguard': {
                'configured': settings.fortyguard_configured,
                'role': 'Spatial thermal evidence, heatmaps and historical analytics',
            },
            'nws': {
                'configured': True,
                'role': 'Official atmospheric fallback and forecast context',
            },
            'deepseek': {
                'configured': settings.deepseek_configured,
                'role': 'Optional explanation assistance after deterministic evidence processing',
            },
        },
        'workspace': {
            'siteCount': len(sites),
            'activeSiteCount': len(active_sites),
            'boundaryReadySiteCount': len(boundary_ready_sites),
            'workerCount': worker_count,
            'zoneCount': zone_count,
            'approvedZoneCount': approved_zone_count,
            'workersBySite': workers_by_site,
        },
        'modules': module_readiness,
        'warnings': warnings,
    }
