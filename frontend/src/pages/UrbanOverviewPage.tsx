import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  ThermometerSun,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type {
  Coordinate,
  FortyGuardDailyProfile,
  FortyGuardLayerStatus,
  RiskLevel,
  Site,
  SiteIntelligence,
  ThermalMapResponse,
  ThermalTile,
} from '../types/site'
import '../urban-overview.css'

const STORAGE_KEY = 'heatshield:selected-urban-district'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const URBAN_SCREENING_THRESHOLD_C = 35

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function temperature(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}°C`
}

function numberOrDash(value?: number | null, digits = 1) {
  return value == null ? '—' : value.toFixed(digits)
}

function riskLabel(risk?: RiskLevel | null) {
  if (!risk) return 'Pending'
  return risk.charAt(0).toUpperCase() + risk.slice(1)
}

function riskTone(risk?: RiskLevel | null) {
  if (risk === 'extreme' || risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  if (risk === 'low') return 'safe'
  return 'neutral'
}

function observedLabel(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function layerLabel(type: FortyGuardLayerStatus['analyticType']) {
  if (type === 'tcm') return 'Temperature cells'
  if (type === 'time_of_measure') return 'Peak timing'
  if (type === 'exceedance') return 'Threshold exceedance'
  return 'Heat persistence'
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#58ad69'
  if (ratio < 0.52) return '#d4bf38'
  if (ratio < 0.70) return '#f0a02c'
  if (ratio < 0.86) return '#ec6833'
  return '#cf3945'
}

function polygonCenter(polygon: Coordinate[]) {
  const points = polygon.length > 1
    && polygon[0].lat === polygon[polygon.length - 1].lat
    && polygon[0].lng === polygon[polygon.length - 1].lng
    ? polygon.slice(0, -1)
    : polygon

  if (!points.length) return null

  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function hotspotLabel(index: number) {
  return index === 0 ? 'Priority hotspot' : `Hotspot ${index + 1}`
}

function DistrictThermalMap({
  district,
  thermal,
  loading,
  onRefresh,
}: {
  district: Site
  thermal: ThermalMapResponse | null
  loading: boolean
  onRefresh: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const thermalOverlaysRef = useRef<google.maps.Polygon[]>([])
  const hotspotMarkersRef = useRef<google.maps.Marker[]>([])
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

  const hottestTiles = useMemo(() => {
    if (thermal?.dataStatus !== 'verified') return []
    return [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC).slice(0, 4)
  }, [thermal])

  useEffect(() => {
    if (!mapsApiKey || !containerRef.current) return

    let cancelled = false
    setMapError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return

        const map = new googleInstance.maps.Map(containerRef.current, {
          center: district.center,
          zoom: 15,
          mapTypeId: 'satellite',
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#d9e3e1',
        })

        mapRef.current = map
        boundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: district.polygon,
          strokeColor: '#f6ffff',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0d8f84',
          fillOpacity: 0.02,
          clickable: false,
          zIndex: 20,
        })

        if (district.polygon.length >= 3) {
          const bounds = new googleInstance.maps.LatLngBounds()
          district.polygon.forEach((point) => bounds.extend(point))
          if (!bounds.isEmpty()) map.fitBounds(bounds, 34)
        }

        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      thermalOverlaysRef.current.forEach((polygon) => polygon.setMap(null))
      hotspotMarkersRef.current.forEach((marker) => marker.setMap(null))
      thermalOverlaysRef.current = []
      hotspotMarkersRef.current = []
      boundaryRef.current?.setMap(null)
      boundaryRef.current = null
      mapRef.current = null
    }
  }, [district.center.lat, district.center.lng, district.id, district.polygon])

  useEffect(() => {
    thermalOverlaysRef.current.forEach((polygon) => polygon.setMap(null))
    hotspotMarkersRef.current.forEach((marker) => marker.setMap(null))
    thermalOverlaysRef.current = []
    hotspotMarkersRef.current = []

    const map = mapRef.current
    if (!map || thermal?.dataStatus !== 'verified' || !window.google?.maps) return

    const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
    const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))

    thermalOverlaysRef.current = thermal.tiles.map((tile) => {
      const color = heatColor(tile.temperatureC, min, max)
      return new google.maps.Polygon({
        map,
        paths: tile.polygon,
        strokeColor: color,
        strokeOpacity: 0.88,
        strokeWeight: tile.id === thermal.hottestTileId ? 2.4 : 0.7,
        fillColor: color,
        fillOpacity: 0.58,
        zIndex: 10,
      })
    })

    hotspotMarkersRef.current = hottestTiles
      .map((tile, index) => {
        const center = polygonCenter(tile.polygon)
        if (!center) return null

        return new google.maps.Marker({
          map,
          position: center,
          zIndex: 45 + index,
          title: `${hotspotLabel(index)} • ${temperature(tile.temperatureC)}`,
          label: {
            text: `${index + 1}`,
            color: '#fff',
            fontWeight: '800',
            fontSize: '11px',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: index === 0 ? 16 : 13,
            fillColor: index === 0 ? '#c93041' : '#e15b37',
            fillOpacity: 0.97,
            strokeColor: '#ffffff',
            strokeWeight: 2.5,
          },
        })
      })
      .filter((marker): marker is google.maps.Marker => Boolean(marker))
  }, [hottestTiles, mapVersion, thermal])

  const verified = thermal?.dataStatus === 'verified'

  return (
    <section className="urban-map panel">
      <div className="urban-card-head">
        <div>
          <span className="urban-eyebrow">DISTRICT THERMAL SURFACE</span>
          <h2>{district.name}</h2>
          <small>
            {verified
              ? `FortyGuard heatmap • ${observedLabel(thermal.observedAt)}`
              : 'Waiting for verified spatial thermal evidence'}
          </small>
        </div>
        <button
          type="button"
          className="urban-icon-button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh FortyGuard evidence"
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="urban-map__canvas">
        {mapsApiKey && !mapError ? (
          <div ref={containerRef} className="urban-map__google" />
        ) : (
          <div className="urban-map__fallback">
            <Layers3 size={30} />
            <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
            <span>FortyGuard evidence can still load; satellite context requires Google Maps.</span>
          </div>
        )}

        <div className="urban-map__source">
          <ShieldCheck size={14} />
          {verified ? `${thermal.tileCount} verified FortyGuard cells` : 'No synthetic heat cells'}
        </div>

        <div className="urban-map__legend">
          <span>{verified ? temperature(thermal.minTemperatureC) : 'Cooler'}</span>
          <i />
          <span>{verified ? temperature(thermal.maxTemperatureC) : 'Hotter'}</span>
        </div>

        {loading && (
          <div className="urban-map__state">
            <RefreshCw size={18} className="spin" />
            <span>Requesting FortyGuard district evidence…</span>
          </div>
        )}

        {!loading && !verified && (
          <div className="urban-map__state urban-map__state--warning">
            <AlertTriangle size={18} />
            <span>{thermal?.message ?? 'Verified thermal cells are unavailable for this district.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function EvidenceRow({
  label,
  status,
  detail,
}: {
  label: string
  status: 'verified' | 'partial' | 'fallback' | 'unavailable'
  detail: string
}) {
  const icon = status === 'verified' || status === 'partial'
    ? <CheckCircle2 size={16} />
    : <AlertTriangle size={16} />

  return (
    <div className={`urban-evidence-row urban-evidence-row--${status}`}>
      <span className="urban-evidence-row__icon">{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span className="urban-evidence-row__status">{status}</span>
    </div>
  )
}

function HotspotRow({
  tile,
  index,
  meanTemperatureC,
}: {
  tile: ThermalTile
  index: number
  meanTemperatureC?: number | null
}) {
  const lift = meanTemperatureC == null ? null : tile.temperatureC - meanTemperatureC

  return (
    <div className="urban-hotspot-row">
      <span className={`urban-hotspot-row__rank${index === 0 ? ' urban-hotspot-row__rank--priority' : ''}`}>{index + 1}</span>
      <div>
        <strong>{hotspotLabel(index)}</strong>
        <small>FortyGuard cell {tile.id.slice(0, 8)}</small>
      </div>
      <div className="urban-hotspot-row__value">
        <strong>{temperature(tile.temperatureC)}</strong>
        <small>{lift == null ? 'mean unavailable' : `${lift >= 0 ? '+' : ''}${lift.toFixed(1)}°C vs mean`}</small>
      </div>
    </div>
  )
}

export function UrbanOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [districts, setDistricts] = useState<Site[]>([])
  const [districtId, setDistrictId] = useState<string | null>(null)
  const [intel, setIntel] = useState<SiteIntelligence | null>(null)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [profile, setProfile] = useState<FortyGuardDailyProfile | null>(null)
  const [loadingDistricts, setLoadingDistricts] = useState(true)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setLoadingDistricts(true)
    api.listSites(controller.signal)
      .then((sites) => {
        if (!active || controller.signal.aborted) return
        setDistricts(sites)

        const requested = searchParams.get('district')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && sites.some((site) => site.id === id))
        setDistrictId(preferred ?? sites[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load district boundaries.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingDistricts(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // Initial district selection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!districtId) return

    localStorage.setItem(STORAGE_KEY, districtId)
    setSearchParams({ district: districtId }, { replace: true })

    const controller = new AbortController()
    let active = true

    setLoadingEvidence(true)
    setError(null)

    Promise.allSettled([
      api.getSiteIntelligence(districtId, controller.signal),
      api.generateThermalMap(
        districtId,
        { mode: 'site', granularityMeters: 80 },
        controller.signal,
      ),
      api.generateFortyGuardProfile(
        districtId,
        { thresholdC: URBAN_SCREENING_THRESHOLD_C, granularityMeters: 80 },
        controller.signal,
      ),
    ]).then(([intelResult, thermalResult, profileResult]) => {
      if (!active || controller.signal.aborted) return

      setIntel(intelResult.status === 'fulfilled' ? intelResult.value : null)
      setThermal(thermalResult.status === 'fulfilled' ? thermalResult.value : null)
      setProfile(profileResult.status === 'fulfilled' ? profileResult.value : null)

      const failures = [intelResult, thermalResult, profileResult].filter((result) => result.status === 'rejected')
      if (failures.length === 3) {
        setError('HeatShield could not load district intelligence or FortyGuard evidence for this boundary.')
      }
    }).finally(() => {
      if (active && !controller.signal.aborted) setLoadingEvidence(false)
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [districtId, refreshKey, setSearchParams])

  const district = useMemo(
    () => districts.find((site) => site.id === districtId) ?? intel?.site ?? null,
    [districtId, districts, intel?.site],
  )

  const verifiedThermal = thermal?.dataStatus === 'verified'
  const profileAvailable = profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial'
  const risk = intel?.risk?.level

  const hottestTiles = useMemo(() => {
    if (!verifiedThermal || !thermal) return []
    return [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC).slice(0, 5)
  }, [thermal, verifiedThermal])

  const hotspotLift = verifiedThermal
    && thermal?.maxTemperatureC != null
    && thermal.meanTemperatureC != null
    ? thermal.maxTemperatureC - thermal.meanTemperatureC
    : null

  const surfaceRange = verifiedThermal
    && thermal?.maxTemperatureC != null
    && thermal.minTemperatureC != null
    ? thermal.maxTemperatureC - thermal.minTemperatureC
    : null

  const evidenceCount = [
    verifiedThermal,
    profileAvailable,
    intel?.conditionSource === 'fortyguard',
  ].filter(Boolean).length

  const brief = verifiedThermal
    ? `FortyGuard verified ${thermal.tileCount} thermal cells across ${district?.name ?? 'the selected district'}. The district mean is ${temperature(thermal.meanTemperatureC)} and the hottest measured cell is ${temperature(thermal.maxTemperatureC)}${hotspotLift == null ? '' : ` (${hotspotLift.toFixed(1)}°C above the district mean)`}. ${profileAvailable && profile?.maxPersistenceHours != null ? `The daily profile shows up to ${profile.maxPersistenceHours.toFixed(1)} hours of heat persistence.` : 'Daily persistence evidence is not fully available.'}`
    : 'HeatShield is waiting for verified FortyGuard spatial evidence. No synthetic hotspot values are shown while provider evidence is unavailable.'

  const environmentalDetail = intel?.conditionSource === 'fortyguard'
    ? `${intel.conditionSourceLabel ?? 'FortyGuard'} • ${observedLabel(intel.observedAt)}`
    : intel?.conditionSource === 'nws'
      ? `Fallback source active • ${intel.conditionSourceLabel ?? 'NWS'}`
      : 'Environmental conditions unavailable'

  const profileDetail = profileAvailable
    ? `${profile?.dataStatus ?? 'partial'} • ${profile?.providerRequestCount ?? 0} provider requests`
    : profile?.message ?? 'Daily temporal layers unavailable'

  return (
    <AppShell module="urban">
      <div className="topbar">
        <h1 className="topbar__title">Urban Heat Intelligence</h1>
        <div className="topbar__spacer" />
        <div className="module-core-status">
          <span className="module-core-status__dot" />
          <span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span>
        </div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </div>

      <main className="urban-overview">
        <section className="urban-overview__hero panel">
          <div className="urban-overview__hero-copy">
            <span className="urban-eyebrow">SCREEN 01 • DISTRICT COMMAND OVERVIEW</span>
            <h1>Urban thermal evidence, before intervention decisions.</h1>
            <p>
              Start with a district boundary, verify FortyGuard surface heat and temporal layers,
              then move into heat-island analysis and intervention evaluation with traceable evidence.
            </p>
          </div>

          <div className="urban-overview__controls">
            <label htmlFor="urban-district-select">Active district</label>
            <div className="urban-select-wrap">
              <MapPin size={16} />
              <select
                id="urban-district-select"
                value={districtId ?? ''}
                onChange={(event) => setDistrictId(event.target.value || null)}
                disabled={loadingDistricts || districts.length === 0}
              >
                {districts.length === 0 && <option value="">No district boundaries</option>}
                {districts.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
            </div>
            <button type="button" className="button button--secondary urban-refresh" onClick={refresh} disabled={!districtId || loadingEvidence}>
              <RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} />
              Refresh evidence
            </button>
          </div>
        </section>

        {loadingDistricts && (
          <StatePanel
            kind="loading"
            title="Loading district boundaries"
            detail="Preparing the urban workspace before requesting provider evidence."
          />
        )}

        {!loadingDistricts && error && !district && (
          <StatePanel
            kind="error"
            title="Urban overview unavailable"
            detail={error}
            onRetry={() => window.location.reload()}
          />
        )}

        {!loadingDistricts && !district && !error && (
          <section className="urban-empty panel">
            <MapPin size={30} />
            <div>
              <h2>No district boundary is available yet.</h2>
              <p>Create or import a boundary first. The overview will never invent spatial heat evidence without a real geometry.</p>
            </div>
            <Link to="/urban/districts" className="button button--primary">Open Districts <ArrowRight size={15} /></Link>
          </section>
        )}

        {district && (
          <>
            <section className="urban-context-bar">
              <div>
                <span className="urban-context-bar__icon"><MapPin size={17} /></span>
                <div><small>District</small><strong>{district.name}</strong><span>{district.address || 'Defined polygon boundary'}</span></div>
              </div>
              <div>
                <span className="urban-context-bar__icon"><Clock3 size={17} /></span>
                <div><small>Thermal observation</small><strong>{observedLabel(thermal?.observedAt)}</strong><span>{thermal?.timezoneName ?? 'Provider timezone pending'}</span></div>
              </div>
              <div>
                <span className="urban-context-bar__icon"><ShieldCheck size={17} /></span>
                <div><small>Evidence readiness</small><strong>{evidenceCount}/3 core feeds</strong><span>{verifiedThermal ? 'Spatial evidence verified' : 'Spatial evidence pending'}</span></div>
              </div>
            </section>

            <section className="urban-metrics" aria-label="District thermal metrics">
              <article className="urban-metric panel">
                <span className="urban-metric__icon"><ThermometerSun size={19} /></span>
                <div><small>Mean surface temperature</small><strong>{verifiedThermal ? temperature(thermal?.meanTemperatureC) : '—'}</strong><span>FortyGuard district cells</span></div>
              </article>
              <article className="urban-metric panel">
                <span className="urban-metric__icon"><Gauge size={19} /></span>
                <div><small>Peak hotspot lift</small><strong>{hotspotLift == null ? '—' : `+${hotspotLift.toFixed(1)}°C`}</strong><span>Peak cell vs district mean</span></div>
              </article>
              <article className="urban-metric panel">
                <span className="urban-metric__icon"><Activity size={19} /></span>
                <div><small>Heat persistence</small><strong>{profileAvailable ? `${numberOrDash(profile?.maxPersistenceHours)} h` : '—'}</strong><span>Maximum verified persistence</span></div>
              </article>
              <article className={`urban-metric panel urban-metric--${riskTone(risk)}`}>
                <span className="urban-metric__icon"><BarChart3 size={19} /></span>
                <div><small>Current screening risk</small><strong>{riskLabel(risk)}</strong><span>{intel?.risk?.summary ?? 'Awaiting condition evidence'}</span></div>
              </article>
            </section>

            {error && (
              <div className="urban-inline-warning">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <section className="urban-primary-grid">
              <DistrictThermalMap district={district} thermal={thermal} loading={loadingEvidence} onRefresh={refresh} />

              <aside className="urban-priority panel">
                <div className="urban-card-head">
                  <div>
                    <span className="urban-eyebrow">PRIORITY CELLS</span>
                    <h2>Where heat concentrates</h2>
                    <small>Ranked directly from verified FortyGuard thermal cells.</small>
                  </div>
                </div>

                <div className="urban-priority__summary">
                  <div><small>Surface range</small><strong>{surfaceRange == null ? '—' : `${surfaceRange.toFixed(1)}°C`}</strong></div>
                  <div><small>Hottest cell</small><strong>{verifiedThermal ? temperature(thermal?.maxTemperatureC) : '—'}</strong></div>
                </div>

                <div className="urban-hotspot-list">
                  {hottestTiles.length > 0
                    ? hottestTiles.map((tile, index) => (
                      <HotspotRow key={tile.id} tile={tile} index={index} meanTemperatureC={thermal?.meanTemperatureC} />
                    ))
                    : (
                      <div className="urban-priority__empty">
                        <AlertTriangle size={20} />
                        <span>No verified hotspot ranking is available.</span>
                      </div>
                    )}
                </div>

                <div className="urban-science-note">
                  <strong>Scientific guardrail</strong>
                  <p>Peak hotspot lift is a within-district comparison. It is not labeled as formal urban heat-island intensity until a valid reference area is compared on the Heat Islands screen.</p>
                </div>
              </aside>
            </section>

            <section className="urban-secondary-grid">
              <article className="urban-profile panel">
                <div className="urban-card-head">
                  <div>
                    <span className="urban-eyebrow">FORTYGUARD DAILY PROFILE</span>
                    <h2>Temporal heat behavior</h2>
                    <small>{profileAvailable ? `${profile?.date} • ${profile?.timezoneName}` : 'Daily profile evidence pending'}</small>
                  </div>
                  <span className={`urban-status-chip urban-status-chip--${profile?.dataStatus ?? 'unavailable'}`}>{profile?.dataStatus ?? 'unavailable'}</span>
                </div>

                <div className="urban-profile__metrics">
                  <div><small>Daily min</small><strong>{profileAvailable ? temperature(profile?.minTemperatureC) : '—'}</strong></div>
                  <div><small>Daily mean</small><strong>{profileAvailable ? temperature(profile?.meanTemperatureC) : '—'}</strong></div>
                  <div><small>Daily max</small><strong>{profileAvailable ? temperature(profile?.maxTemperatureC) : '—'}</strong></div>
                  <div><small>Peak timing</small><strong>{profileAvailable ? profile?.peakHourLocal ?? '—' : '—'}</strong></div>
                  <div><small>Max above {URBAN_SCREENING_THRESHOLD_C}°C</small><strong>{profileAvailable ? `${numberOrDash(profile?.maxHoursAboveThreshold)} h` : '—'}</strong></div>
                  <div><small>Max persistence</small><strong>{profileAvailable ? `${numberOrDash(profile?.maxPersistenceHours)} h` : '—'}</strong></div>
                </div>

                <div className="urban-layer-grid">
                  {(profile?.layers ?? []).map((layer) => (
                    <div key={layer.analyticType} className={`urban-layer urban-layer--${layer.status}`}>
                      <span>{layer.status === 'verified' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
                      <div><strong>{layerLabel(layer.analyticType)}</strong><small>{layer.status === 'verified' ? `${layer.cellCount} cells${layer.units ? ` • ${layer.units}` : ''}` : layer.message ?? 'Unavailable'}</small></div>
                    </div>
                  ))}
                  {(profile?.layers ?? []).length === 0 && (
                    <div className="urban-layer urban-layer--unavailable"><AlertTriangle size={15} /><div><strong>Temporal layers</strong><small>No provider layers returned yet.</small></div></div>
                  )}
                </div>
              </article>

              <article className="urban-evidence panel">
                <div className="urban-card-head">
                  <div>
                    <span className="urban-eyebrow">EVIDENCE INTEGRITY</span>
                    <h2>What this screen can prove</h2>
                    <small>Every decision surface keeps provider status visible.</small>
                  </div>
                </div>

                <div className="urban-evidence-list">
                  <EvidenceRow
                    label="Spatial thermal map"
                    status={verifiedThermal ? 'verified' : 'unavailable'}
                    detail={verifiedThermal ? `${thermal?.tileCount ?? 0} cells • ${observedLabel(thermal?.observedAt)}` : thermal?.message ?? 'FortyGuard heatmap unavailable'}
                  />
                  <EvidenceRow
                    label="Daily temporal profile"
                    status={profile?.dataStatus === 'verified' ? 'verified' : profile?.dataStatus === 'partial' ? 'partial' : 'unavailable'}
                    detail={profileDetail}
                  />
                  <EvidenceRow
                    label="Environmental conditions"
                    status={intel?.conditionSource === 'fortyguard' ? 'verified' : intel?.conditionSource === 'nws' ? 'fallback' : 'unavailable'}
                    detail={environmentalDetail}
                  />
                </div>

                <div className="urban-evidence__rule">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>No silent substitution</strong>
                    <p>FortyGuard surface evidence, fallback environmental conditions, and HeatShield-derived screening are presented as separate layers.</p>
                  </div>
                </div>
              </article>
            </section>

            <section className="urban-brief panel">
              <div className="urban-brief__main">
                <span className="urban-eyebrow">EVIDENCE BRIEF</span>
                <h2>What the verified data says now</h2>
                <p>{brief}</p>
              </div>
              <div className="urban-brief__actions">
                <Link to="/urban/heat-islands" className="urban-next-link">
                  <span><strong>Heat Islands</strong><small>Compare hotspot cells against a valid reference area.</small></span>
                  <ArrowRight size={17} />
                </Link>
                <Link to="/urban/analysis" className="urban-next-link">
                  <span><strong>Urban Analysis</strong><small>Investigate drivers and evidence together.</small></span>
                  <ArrowRight size={17} />
                </Link>
                <Link to="/urban/interventions" className="urban-next-link">
                  <span><strong>Interventions</strong><small>Connect cooling actions to measured heat problems.</small></span>
                  <ArrowRight size={17} />
                </Link>
              </div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
