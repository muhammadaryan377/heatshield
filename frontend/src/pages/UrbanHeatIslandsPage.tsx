import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crosshair,
  Flame,
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
import { filterUrbanDistricts } from '../lib/urbanDistricts'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../types/history'
import type { Coordinate, Site, ThermalMapResponse, ThermalTile } from '../types/site'
import '../urban-heat-islands.css'

const SELECTED_DISTRICT_KEY = 'heatshield:selected-urban-district'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const GRANULARITY_METERS = 80

type MapLayer = 'temperature' | 'persistence' | 'exceedance'
type CandidateLevel = 'priority' | 'elevated' | 'watch'

type HeatIslandCandidate = {
  id: string
  cell: HistoricalHeatCell
  score: number
  level: CandidateLevel
  temperatureC: number | null
  liftC: number | null
  exceedanceHours: number | null
  persistenceHours: number | null
  peakHourLocal: string | null
  evidenceFeeds: number
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function temperature(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}°C`
}

function hours(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)} h`
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

function shortDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function historyRange(days: number) {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 1)
  end.setUTCHours(12, 0, 0, 0)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1))
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

function polygonCenter(points: Coordinate[]) {
  const clean = points.length > 1
    && points[0].lat === points[points.length - 1].lat
    && points[0].lng === points[points.length - 1].lng
    ? points.slice(0, -1)
    : points

  if (!clean.length) return null
  return {
    lat: clean.reduce((sum, point) => sum + point.lat, 0) / clean.length,
    lng: clean.reduce((sum, point) => sum + point.lng, 0) / clean.length,
  }
}

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng
    const yi = polygon[i].lat
    const xj = polygon[j].lng
    const yj = polygon[j].lat
    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function findThermalTile(center: Coordinate | null, thermal: ThermalMapResponse | null): ThermalTile | null {
  if (!center || thermal?.dataStatus !== 'verified') return null
  return thermal.tiles.find((tile) => pointInPolygon(center, tile.polygon)) ?? null
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function positiveRelative(value: number | null, mean: number | null, max: number | null) {
  if (value == null || mean == null || max == null) return null
  if (value <= mean) return 0
  if (max <= mean) return 1
  return clamp((value - mean) / (max - mean))
}

function candidateLevel(score: number): CandidateLevel {
  if (score >= 70) return 'priority'
  if (score >= 45) return 'elevated'
  return 'watch'
}

function candidateLabel(level: CandidateLevel) {
  if (level === 'priority') return 'Priority candidate'
  if (level === 'elevated') return 'Elevated candidate'
  return 'Watch candidate'
}

function buildCandidates(
  history: HistoricalHeatBehaviorResponse | null,
  thermal: ThermalMapResponse | null,
): HeatIslandCandidate[] {
  if (!history || !history.cells.length) return []

  const thermalVerified = thermal?.dataStatus === 'verified'
  const districtMeanTemperature = thermalVerified ? thermal.meanTemperatureC ?? null : null
  const maxThermalLift = thermalVerified
    && thermal.maxTemperatureC != null
    && districtMeanTemperature != null
    ? Math.max(thermal.maxTemperatureC - districtMeanTemperature, 0)
    : null

  return history.cells.map((cell) => {
    const center = polygonCenter(cell.polygon)
    const tile = findThermalTile(center, thermal)
    const currentTemperature = tile?.temperatureC ?? null
    const lift = currentTemperature != null && districtMeanTemperature != null
      ? currentTemperature - districtMeanTemperature
      : null

    const thermalFactor = lift == null || maxThermalLift == null
      ? null
      : maxThermalLift <= 0 ? 0 : clamp(Math.max(lift, 0) / maxThermalLift)
    const exceedanceFactor = positiveRelative(
      cell.exceedanceHours ?? null,
      history.meanExceedanceHours ?? null,
      history.maxExceedanceHours ?? null,
    )
    const persistenceFactor = positiveRelative(
      cell.persistenceHours ?? null,
      history.meanPersistenceHours ?? null,
      history.maxPersistenceHours ?? null,
    )

    const weighted = [
      { value: thermalFactor, weight: 0.45 },
      { value: exceedanceFactor, weight: 0.30 },
      { value: persistenceFactor, weight: 0.25 },
    ].filter((item): item is { value: number; weight: number } => item.value != null)

    const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0)
    const rawScore = weightTotal
      ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal
      : 0
    const score = Math.round(clamp(rawScore) * 100)

    return {
      id: cell.id,
      cell,
      score,
      level: candidateLevel(score),
      temperatureC: currentTemperature,
      liftC: lift,
      exceedanceHours: cell.exceedanceHours ?? null,
      persistenceHours: cell.persistenceHours ?? null,
      peakHourLocal: cell.peakHourLocal ?? null,
      evidenceFeeds: weighted.length,
    }
  }).sort((a, b) => b.score - a.score)
}

function layerValue(cell: HistoricalHeatCell, layer: MapLayer) {
  if (layer === 'persistence') return cell.persistenceHours ?? null
  if (layer === 'exceedance') return cell.exceedanceHours ?? null
  return null
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = clamp((value - min) / span)
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#52a96b'
  if (ratio < 0.52) return '#c8b63e'
  if (ratio < 0.70) return '#ee9b2c'
  if (ratio < 0.86) return '#eb6635'
  return '#ca3948'
}

function HeatIslandMap({
  district,
  thermal,
  history,
  candidates,
  layer,
}: {
  district: Site
  thermal: ThermalMapResponse | null
  history: HistoricalHeatBehaviorResponse | null
  candidates: HeatIslandCandidate[]
  layer: MapLayer
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const overlayRefs = useRef<google.maps.Polygon[]>([])
  const markerRefs = useRef<google.maps.Marker[]>([])
  const [mapVersion, setMapVersion] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapsApiKey || !mapElement.current) return
    let cancelled = false
    setMapError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return

        const map = new googleInstance.maps.Map(mapElement.current, {
          center: district.center,
          zoom: 14,
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          gestureHandling: 'greedy',
        })
        mapRef.current = map

        boundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: district.polygon,
          strokeColor: '#f8ffff',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0b8b87',
          fillOpacity: 0.025,
          clickable: false,
          zIndex: 30,
        })

        const bounds = new googleInstance.maps.LatLngBounds()
        district.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 34)
        setMapVersion((value) => value + 1)
      })
      .catch((cause: Error) => {
        if (!cancelled) setMapError(cause.message)
      })

    return () => {
      cancelled = true
      overlayRefs.current.forEach((polygon) => polygon.setMap(null))
      markerRefs.current.forEach((marker) => marker.setMap(null))
      overlayRefs.current = []
      markerRefs.current = []
      boundaryRef.current?.setMap(null)
      boundaryRef.current = null
      mapRef.current = null
    }
  }, [district.center.lat, district.center.lng, district.id, district.polygon])

  useEffect(() => {
    overlayRefs.current.forEach((polygon) => polygon.setMap(null))
    markerRefs.current.forEach((marker) => marker.setMap(null))
    overlayRefs.current = []
    markerRefs.current = []

    const map = mapRef.current
    if (!map || !window.google?.maps) return

    if (layer === 'temperature' && thermal?.dataStatus === 'verified' && thermal.tiles.length) {
      const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
      const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))
      overlayRefs.current = thermal.tiles.map((tile) => {
        const color = heatColor(tile.temperatureC, min, max)
        return new google.maps.Polygon({
          map,
          paths: tile.polygon,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: tile.id === thermal.hottestTileId ? 2.4 : 0.65,
          fillColor: color,
          fillOpacity: 0.58,
          clickable: false,
          zIndex: 12,
        })
      })
    }

    if (layer !== 'temperature' && history?.cells.length) {
      const values = history.cells
        .map((cell) => layerValue(cell, layer))
        .filter((value): value is number => value != null)
      if (values.length) {
        const min = Math.min(...values)
        const max = Math.max(...values)
        overlayRefs.current = history.cells.flatMap((cell) => {
          const value = layerValue(cell, layer)
          if (value == null) return []
          const color = heatColor(value, min, max)
          return [new google.maps.Polygon({
            map,
            paths: cell.polygon,
            strokeColor: color,
            strokeOpacity: 0.9,
            strokeWeight: 0.7,
            fillColor: color,
            fillOpacity: 0.57,
            clickable: false,
            zIndex: 12,
          })]
        })
      }
    }

    markerRefs.current = candidates.slice(0, 6).flatMap((candidate, index) => {
      const center = polygonCenter(candidate.cell.polygon)
      if (!center) return []
      return [new google.maps.Marker({
        map,
        position: center,
        zIndex: 50 + index,
        title: `${candidateLabel(candidate.level)} • score ${candidate.score}`,
        label: {
          text: `${index + 1}`,
          color: '#fff',
          fontWeight: '800',
          fontSize: '11px',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: index === 0 ? 16 : 13,
          fillColor: candidate.level === 'priority' ? '#c83243' : candidate.level === 'elevated' ? '#e87232' : '#b99835',
          fillOpacity: 0.98,
          strokeColor: '#ffffff',
          strokeWeight: 2.4,
        },
      })]
    })
  }, [candidates, history, layer, mapVersion, thermal])

  const layerReady = layer === 'temperature'
    ? thermal?.dataStatus === 'verified'
    : history?.dataStatus === 'verified' || history?.dataStatus === 'partial'

  return (
    <div className="uhi-map">
      {mapsApiKey && !mapError ? (
        <div ref={mapElement} className="uhi-map__google" />
      ) : (
        <div className="uhi-map__fallback">
          <Layers3 size={30} />
          <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
          <span>FortyGuard analysis can still run, but satellite spatial context requires Google Maps.</span>
        </div>
      )}

      <div className="uhi-map__source">
        <ShieldCheck size={14} />
        {layerReady ? 'Verified FortyGuard evidence' : 'No synthetic spatial values'}
      </div>

      <div className="uhi-map__legend">
        <span>Lower</span><i /><span>Higher</span>
        <small>{layer === 'temperature' ? 'surface temperature' : layer === 'persistence' ? 'heat persistence' : 'threshold exceedance'}</small>
      </div>
    </div>
  )
}

function EvidenceStatus({
  title,
  ready,
  detail,
}: {
  title: string
  ready: boolean
  detail: string
}) {
  return (
    <div className={`uhi-evidence-row${ready ? ' uhi-evidence-row--ready' : ''}`}>
      <span>{ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
      <b>{ready ? 'verified' : 'pending'}</b>
    </div>
  )
}

export function UrbanHeatIslandsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [districts, setDistricts] = useState<Site[]>([])
  const [districtId, setDistrictId] = useState<string | null>(null)
  const [lookbackDays, setLookbackDays] = useState(30)
  const [thresholdF, setThresholdF] = useState(95)
  const [layer, setLayer] = useState<MapLayer>('persistence')
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [history, setHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
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
        const urbanDistricts = filterUrbanDistricts(sites)
        setDistricts(urbanDistricts)
        const requested = searchParams.get('district')
        const stored = localStorage.getItem(SELECTED_DISTRICT_KEY)
        const preferred = [requested, stored].find((id) => id && urbanDistricts.some((site) => site.id === id))
        setDistrictId(preferred ?? urbanDistricts[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load urban districts.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingDistricts(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // Initial route preference only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!districtId) return

    localStorage.setItem(SELECTED_DISTRICT_KEY, districtId)
    setSearchParams({ district: districtId }, { replace: true })
    const controller = new AbortController()
    let active = true
    setLoadingEvidence(true)
    setError(null)

    const range = historyRange(lookbackDays)
    Promise.allSettled([
      api.generateThermalMap(
        districtId,
        { mode: 'site', granularityMeters: GRANULARITY_METERS },
        controller.signal,
      ),
      api.generateHistoricalHeatBehavior(
        districtId,
        {
          startDate: range.startDate,
          endDate: range.endDate,
          thresholdF,
          granularityMeters: GRANULARITY_METERS,
        },
        controller.signal,
      ),
    ]).then(([thermalResult, historyResult]) => {
      if (!active || controller.signal.aborted) return
      setThermal(thermalResult.status === 'fulfilled' ? thermalResult.value : null)
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : null)

      if (thermalResult.status === 'rejected' && historyResult.status === 'rejected') {
        setError('HeatShield could not load current or historical FortyGuard evidence for this district.')
      } else if (historyResult.status === 'rejected') {
        setError(historyResult.reason instanceof Error ? historyResult.reason.message : 'Historical FortyGuard evidence is unavailable.')
      }
    }).finally(() => {
      if (active && !controller.signal.aborted) setLoadingEvidence(false)
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [districtId, lookbackDays, refreshKey, setSearchParams, thresholdF])

  const district = useMemo(
    () => districts.find((site) => site.id === districtId) ?? null,
    [districtId, districts],
  )

  const candidates = useMemo(() => buildCandidates(history, thermal), [history, thermal])
  const visibleCandidates = candidates.slice(0, 8)
  const priorityCount = candidates.filter((candidate) => candidate.level === 'priority').length
  const elevatedCount = candidates.filter((candidate) => candidate.level === 'elevated').length
  const thermalReady = thermal?.dataStatus === 'verified'
  const historyReady = history?.dataStatus === 'verified' || history?.dataStatus === 'partial'
  const currentLift = thermalReady
    && thermal.maxTemperatureC != null
    && thermal.meanTemperatureC != null
    ? thermal.maxTemperatureC - thermal.meanTemperatureC
    : null
  const evidenceFeeds = [thermalReady, historyReady].filter(Boolean).length
  const topCandidate = candidates[0] ?? null

  const summary = topCandidate
    ? `${candidateLabel(topCandidate.level)} #1 scores ${topCandidate.score}/100 from ${topCandidate.evidenceFeeds} verified spatial signal${topCandidate.evidenceFeeds === 1 ? '' : 's'}. ${topCandidate.liftC == null ? 'Current thermal lift is unavailable.' : `Its current surface cell is ${topCandidate.liftC >= 0 ? '+' : ''}${topCandidate.liftC.toFixed(1)}°C versus the district mean.`} ${topCandidate.persistenceHours == null ? '' : `Historical persistence reaches ${topCandidate.persistenceHours.toFixed(1)} hours in the selected ${lookbackDays}-day window.`}`
    : 'No heat-island candidate can be ranked until FortyGuard returns usable spatial history for this district.'

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

      <main className="uhi-page">
        <section className="uhi-hero panel">
          <div>
            <span className="uhi-eyebrow">SCREEN 03 • HEAT ISLANDS</span>
            <h1>Find the places where heat is both hotter and persistent.</h1>
            <p>
              Rank localized heat-island candidates by combining verified FortyGuard surface-temperature anomaly,
              threshold exceedance and historical persistence inside the selected district.
            </p>
          </div>
          <div className="uhi-hero__badge">
            <Crosshair size={20} />
            <span><small>ANALYSIS MODE</small><strong>Spatial + historical</strong></span>
          </div>
        </section>

        <section className="uhi-controls panel">
          <label>
            <span>District</span>
            <div><MapPin size={15} /><select value={districtId ?? ''} onChange={(event) => setDistrictId(event.target.value || null)} disabled={!districts.length}>
              {!districts.length && <option value="">No urban districts</option>}
              {districts.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select></div>
          </label>
          <label>
            <span>Historical window</span>
            <div><CalendarDays size={15} /><select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select></div>
          </label>
          <label>
            <span>Heat threshold</span>
            <div><ThermometerSun size={15} /><select value={thresholdF} onChange={(event) => setThresholdF(Number(event.target.value))}>
              <option value={90}>90°F / 32.2°C</option>
              <option value={95}>95°F / 35.0°C</option>
              <option value={100}>100°F / 37.8°C</option>
              <option value={105}>105°F / 40.6°C</option>
            </select></div>
          </label>
          <button type="button" className="button button--secondary uhi-refresh" onClick={refresh} disabled={!districtId || loadingEvidence}>
            <RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} /> Refresh evidence
          </button>
        </section>

        {loadingDistricts && <StatePanel kind="loading" title="Loading urban districts" detail="Preparing registered boundaries for heat-island analysis…" />}

        {!loadingDistricts && !district && (
          <section className="uhi-empty panel">
            <MapPin size={30} />
            <div><h2>Create a district first</h2><p>Heat-island analysis needs a real polygon boundary before FortyGuard spatial evidence can be requested.</p></div>
            <Link to="/urban/districts" className="button button--primary">Open Districts <ArrowRight size={15} /></Link>
          </section>
        )}

        {district && (
          <>
            <section className="uhi-context">
              <div><MapPin size={16} /><span><small>District</small><strong>{district.name}</strong><b>{district.address || 'Saved polygon boundary'}</b></span></div>
              <div><Clock3 size={16} /><span><small>Current thermal</small><strong>{observedLabel(thermal?.observedAt)}</strong><b>{thermalReady ? `${thermal?.tileCount ?? 0} verified cells` : 'provider evidence pending'}</b></span></div>
              <div><CalendarDays size={16} /><span><small>Historical evidence</small><strong>{history ? `${shortDate(history.startDate)} – ${shortDate(history.endDate)}` : `${lookbackDays}-day request`}</strong><b>{historyReady ? `${history?.cellCount ?? 0} spatial cells` : 'provider evidence pending'}</b></span></div>
            </section>

            <section className="uhi-metrics">
              <article className="uhi-metric panel"><span><Gauge size={18} /></span><div><small>Peak local anomaly</small><strong>{currentLift == null ? '—' : `+${currentLift.toFixed(1)}°C`}</strong><b>hottest cell vs district mean</b></div></article>
              <article className="uhi-metric panel"><span><Flame size={18} /></span><div><small>Max persistence</small><strong>{hours(history?.maxPersistenceHours)}</strong><b>{lookbackDays}-day historical layer</b></div></article>
              <article className="uhi-metric panel"><span><BarChart3 size={18} /></span><div><small>Max exceedance</small><strong>{hours(history?.maxExceedanceHours)}</strong><b>above {thresholdF}°F threshold</b></div></article>
              <article className="uhi-metric panel"><span><Clock3 size={18} /></span><div><small>Common peak period</small><strong>{history?.commonPeakPeriodLocal ?? history?.commonPeakHourLocal ?? '—'}</strong><b>FortyGuard peak-time layer</b></div></article>
            </section>

            {error && <div className="uhi-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="uhi-main-grid">
              <div className="uhi-map-card panel">
                <div className="uhi-card-head">
                  <div><span className="uhi-eyebrow">SPATIAL EVIDENCE</span><h2>Heat-island candidate map</h2><small>Switch layers without changing the district or historical evidence window.</small></div>
                  <div className="uhi-layer-toggle" role="group" aria-label="Map layer">
                    <button type="button" className={layer === 'temperature' ? 'is-active' : ''} onClick={() => setLayer('temperature')}>Temperature</button>
                    <button type="button" className={layer === 'persistence' ? 'is-active' : ''} onClick={() => setLayer('persistence')}>Persistence</button>
                    <button type="button" className={layer === 'exceedance' ? 'is-active' : ''} onClick={() => setLayer('exceedance')}>Exceedance</button>
                  </div>
                </div>
                <HeatIslandMap district={district} thermal={thermal} history={history} candidates={candidates} layer={layer} />
              </div>

              <aside className="uhi-ranking panel">
                <div className="uhi-card-head">
                  <div><span className="uhi-eyebrow">RANKED CANDIDATES</span><h2>Persistent hotspots</h2><small>Derived score; every component remains visible below.</small></div>
                  <span className="uhi-count-badge">{candidates.length}</span>
                </div>

                {loadingEvidence && !history ? (
                  <div className="uhi-loading"><RefreshCw className="spin" size={18} /> Reading FortyGuard spatial history…</div>
                ) : visibleCandidates.length ? (
                  <div className="uhi-candidate-list">
                    {visibleCandidates.map((candidate, index) => (
                      <article key={candidate.id} className={`uhi-candidate uhi-candidate--${candidate.level}`}>
                        <span className="uhi-candidate__rank">{index + 1}</span>
                        <div className="uhi-candidate__body">
                          <div><strong>{candidateLabel(candidate.level)}</strong><span>{candidate.score}/100</span></div>
                          <small>Cell {candidate.id.slice(0, 10)} • {candidate.evidenceFeeds}/3 scoring feeds</small>
                          <div className="uhi-candidate__metrics">
                            <span><b>{temperature(candidate.temperatureC)}</b><small>current</small></span>
                            <span><b>{candidate.liftC == null ? '—' : `${candidate.liftC >= 0 ? '+' : ''}${candidate.liftC.toFixed(1)}°C`}</b><small>vs mean</small></span>
                            <span><b>{hours(candidate.persistenceHours)}</b><small>persistence</small></span>
                            <span><b>{hours(candidate.exceedanceHours)}</b><small>exceedance</small></span>
                          </div>
                          <div className="uhi-candidate__peak"><Clock3 size={13} /> Peak {candidate.peakHourLocal ?? 'time unavailable'}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="uhi-empty-mini"><AlertTriangle size={20} /><strong>No rankable cells</strong><span>{history?.message ?? 'Historical FortyGuard cells are not available for this district and window.'}</span></div>
                )}
              </aside>
            </section>

            <section className="uhi-secondary-grid">
              <article className="uhi-brief panel">
                <div className="uhi-card-head"><div><span className="uhi-eyebrow">HEATSHIELD SYNTHESIS</span><h2>What the evidence says</h2></div><span className="uhi-core-pill"><ShieldCheck size={14} /> FortyGuard grounded</span></div>
                <p>{summary}</p>
                <div className="uhi-brief__stats">
                  <span><b>{priorityCount}</b><small>priority candidates</small></span>
                  <span><b>{elevatedCount}</b><small>elevated candidates</small></span>
                  <span><b>{evidenceFeeds}/2</b><small>core evidence feeds</small></span>
                </div>
                <Link to={`/urban/analysis?district=${encodeURIComponent(district.id)}`} className="button button--primary">Open Urban Analysis <ArrowRight size={15} /></Link>
              </article>

              <article className="uhi-evidence panel">
                <div className="uhi-card-head"><div><span className="uhi-eyebrow">EVIDENCE INTEGRITY</span><h2>What is actually verified</h2></div></div>
                <EvidenceStatus title="Current surface heat" ready={thermalReady} detail={thermalReady ? `${thermal?.tileCount ?? 0} FortyGuard TCM cells • ${observedLabel(thermal?.observedAt)}` : thermal?.message ?? 'Current/recent thermal layer unavailable'} />
                <EvidenceStatus title="Historical spatial behavior" ready={historyReady} detail={historyReady ? `${history?.cellCount ?? 0} cells • ${history?.providerRequestCount ?? 0} provider requests` : history?.message ?? 'Historical layers unavailable'} />
                <EvidenceStatus title="Formal UHI reference" ready={false} detail="No rural/control reference polygon is configured on this screen; candidate scores are intra-district anomalies, not formal city-vs-rural UHI intensity." />
              </article>

              <article className="uhi-method panel">
                <div className="uhi-card-head"><div><span className="uhi-eyebrow">METHOD</span><h2>Candidate scoring</h2></div></div>
                <div className="uhi-method__row"><span>45%</span><div><strong>Current surface anomaly</strong><small>Cell temperature above the selected district mean.</small></div></div>
                <div className="uhi-method__row"><span>30%</span><div><strong>Threshold exceedance</strong><small>Historical hours above the selected heat threshold relative to district cells.</small></div></div>
                <div className="uhi-method__row"><span>25%</span><div><strong>Heat persistence</strong><small>Historical persistence relative to the district baseline.</small></div></div>
                <p>Missing provider layers are removed from the weighted denominator rather than replaced with invented values.</p>
              </article>
            </section>

            <section className="uhi-guardrail panel">
              <AlertTriangle size={18} />
              <div>
                <strong>Scientific guardrail</strong>
                <p>
                  “Heat-island candidate” here means a localized intra-district anomaly supported by FortyGuard spatial and historical evidence.
                  A formal urban heat-island intensity claim requires a defensible urban-versus-reference comparison with matched observation timing.
                </p>
              </div>
              <Link to="/urban/districts" className="button button--secondary">Review boundaries</Link>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
