import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crosshair,
  Eye,
  Gauge,
  Image as ImageIcon,
  Layers3,
  Leaf,
  MapPin,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
  Trees,
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
import type { UrbanMorphologyResponse, UrbanSegmentationLayer } from '../types/urban'
import '../urban-analysis.css'

const SELECTED_DISTRICT_KEY = 'heatshield:selected-urban-district'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const GRANULARITY_METERS = 80

type AnalysisCandidate = {
  id: string
  polygon: Coordinate[]
  score: number
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

function percent(value?: number | null, digits = 0) {
  return value == null ? '—' : `${value.toFixed(digits)}%`
}

function signedTemperature(value?: number | null) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}°C`
}

function observedLabel(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

function relativeAbove(value: number | null, mean: number | null, max: number | null) {
  if (value == null || mean == null || max == null) return null
  if (value <= mean) return 0
  if (max <= mean) return 1
  return clamp((value - mean) / (max - mean))
}

function buildCandidates(history: HistoricalHeatBehaviorResponse | null, thermal: ThermalMapResponse | null): AnalysisCandidate[] {
  const thermalReady = thermal?.dataStatus === 'verified' && thermal.tiles.length > 0
  const meanTemperature = thermalReady ? thermal.meanTemperatureC ?? null : null
  const maxLift = thermalReady && thermal.maxTemperatureC != null && meanTemperature != null
    ? Math.max(thermal.maxTemperatureC - meanTemperature, 0)
    : null

  if (history?.cells.length) {
    return history.cells.map((cell: HistoricalHeatCell) => {
      const center = polygonCenter(cell.polygon)
      const tile = findThermalTile(center, thermal)
      const current = tile?.temperatureC ?? null
      const lift = current != null && meanTemperature != null ? current - meanTemperature : null
      const thermalFactor = lift == null || maxLift == null ? null : maxLift <= 0 ? 0 : clamp(Math.max(lift, 0) / maxLift)
      const persistenceFactor = relativeAbove(cell.persistenceHours ?? null, history.meanPersistenceHours ?? null, history.maxPersistenceHours ?? null)
      const exceedanceFactor = relativeAbove(cell.exceedanceHours ?? null, history.meanExceedanceHours ?? null, history.maxExceedanceHours ?? null)
      const weighted = [
        { value: thermalFactor, weight: 0.5 },
        { value: persistenceFactor, weight: 0.3 },
        { value: exceedanceFactor, weight: 0.2 },
      ].filter((item): item is { value: number; weight: number } => item.value != null)
      const denominator = weighted.reduce((sum, item) => sum + item.weight, 0)
      const score = denominator
        ? Math.round(weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / denominator * 100)
        : 0
      return {
        id: cell.id,
        polygon: cell.polygon,
        score,
        temperatureC: current,
        liftC: lift,
        exceedanceHours: cell.exceedanceHours ?? null,
        persistenceHours: cell.persistenceHours ?? null,
        peakHourLocal: cell.peakHourLocal ?? null,
        evidenceFeeds: weighted.length,
      }
    }).sort((a, b) => b.score - a.score)
  }

  if (!thermalReady || !thermal) return []
  const ordered = [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC)
  return ordered.map((tile) => {
    const lift = meanTemperature == null ? null : tile.temperatureC - meanTemperature
    const score = maxLift && lift != null ? Math.round(clamp(Math.max(lift, 0) / maxLift) * 100) : 0
    return {
      id: tile.id,
      polygon: tile.polygon,
      score,
      temperatureC: tile.temperatureC,
      liftC: lift,
      exceedanceHours: null,
      persistenceHours: null,
      peakHourLocal: null,
      evidenceFeeds: 1,
    }
  })
}

function timestampsMatched(a?: string | null, b?: string | null) {
  if (!a || !b) return false
  const first = new Date(a).getTime()
  const second = new Date(b).getTime()
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false
  return Math.abs(first - second) <= 75 * 60 * 1000
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = clamp((value - min) / span)
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#52a96b'
  if (ratio < 0.52) return '#c8b63e'
  if (ratio < 0.7) return '#ee9b2c'
  if (ratio < 0.86) return '#eb6635'
  return '#ca3948'
}

function AnalysisMap({ district, thermal, selected }: { district: Site; thermal: ThermalMapResponse | null; selected: AnalysisCandidate | null }) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<google.maps.Polygon[]>([])
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const [mapVersion, setMapVersion] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapsApiKey || !mapElement.current) return
    let cancelled = false
    setMapError(null)
    loadGoogleMaps(mapsApiKey).then((googleInstance) => {
      if (cancelled || !mapElement.current) return
      const map = new googleInstance.maps.Map(mapElement.current, {
        center: district.center,
        zoom: 15,
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
        fillOpacity: 0.02,
        clickable: false,
        zIndex: 30,
      })
      const bounds = new googleInstance.maps.LatLngBounds()
      district.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 34)
      setMapVersion((value) => value + 1)
    }).catch((cause: Error) => {
      if (!cancelled) setMapError(cause.message)
    })
    return () => {
      cancelled = true
      overlaysRef.current.forEach((polygon) => polygon.setMap(null))
      overlaysRef.current = []
      boundaryRef.current?.setMap(null)
      boundaryRef.current = null
      markerRef.current?.setMap(null)
      markerRef.current = null
      mapRef.current = null
    }
  }, [district.center.lat, district.center.lng, district.id, district.polygon])

  useEffect(() => {
    overlaysRef.current.forEach((polygon) => polygon.setMap(null))
    overlaysRef.current = []
    markerRef.current?.setMap(null)
    markerRef.current = null
    const map = mapRef.current
    if (!map || !window.google?.maps) return

    if (thermal?.dataStatus === 'verified' && thermal.tiles.length) {
      const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
      const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))
      overlaysRef.current = thermal.tiles.map((tile) => {
        const isSelected = selected?.polygon === tile.polygon || selected?.id === tile.id
        const color = heatColor(tile.temperatureC, min, max)
        return new google.maps.Polygon({
          map,
          paths: tile.polygon,
          strokeColor: isSelected ? '#ffffff' : color,
          strokeOpacity: 0.95,
          strokeWeight: isSelected ? 3 : 0.7,
          fillColor: color,
          fillOpacity: isSelected ? 0.72 : 0.54,
          clickable: false,
          zIndex: isSelected ? 25 : 12,
        })
      })
    }

    const center = selected ? polygonCenter(selected.polygon) : null
    if (center) {
      markerRef.current = new google.maps.Marker({
        map,
        position: center,
        title: `Selected hotspot • score ${selected.score}`,
        zIndex: 60,
        label: { text: 'A', color: '#fff', fontWeight: '800', fontSize: '12px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 17,
          fillColor: '#c83243',
          fillOpacity: 0.98,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
        },
      })
      map.panTo(center)
    }
  }, [mapVersion, selected, thermal])

  return (
    <div className="ua-map">
      {mapsApiKey && !mapError ? <div ref={mapElement} className="ua-map__google" /> : (
        <div className="ua-map__fallback"><Layers3 size={30} /><strong>{mapError ?? 'Google Maps API key is not configured.'}</strong><span>FortyGuard analysis can still run; satellite basemap context needs Google Maps.</span></div>
      )}
      <div className="ua-map__source"><ShieldCheck size={14} /> {thermal?.dataStatus === 'verified' ? `${thermal.tileCount} verified thermal cells` : 'No synthetic thermal cells'}</div>
      <div className="ua-map__legend"><span>Cooler</span><i /><span>Hotter</span></div>
    </div>
  )
}

function SegmentationPanel({ title, icon, layer }: { title: string; icon: 'satellite' | 'street'; layer: UrbanSegmentationLayer }) {
  const entries = Object.entries(layer.segments).sort((a, b) => b[1] - a[1]).slice(0, 8)
  return (
    <article className="ua-segmentation">
      <div className="ua-segmentation__head">
        <span>{icon === 'satellite' ? <ImageIcon size={18} /> : <Eye size={18} />}</span>
        <div><strong>{title}</strong><small>{layer.status === 'verified' ? (layer.imageDate ?? (layer.imageYear ? `Imagery ${layer.imageYear}` : 'FortyGuard verified')) : 'Unavailable'}</small></div>
        <b className={`ua-status ua-status--${layer.status}`}>{layer.status}</b>
      </div>
      {layer.status === 'verified' ? (
        <>
          {(layer.originalImageDataUrl || layer.segmentedImageDataUrl) && (
            <div className="ua-segmentation__images">
              {layer.originalImageDataUrl && <figure><img src={layer.originalImageDataUrl} alt={`${title} source`} /><figcaption>Source imagery</figcaption></figure>}
              {layer.segmentedImageDataUrl && <figure><img src={layer.segmentedImageDataUrl} alt={`${title} segmentation`} /><figcaption>Segmentation mask</figcaption></figure>}
            </div>
          )}
          <div className="ua-segment-bars">
            {entries.map(([label, value]) => <div key={label}><span><b>{label.replaceAll('_', ' ')}</b><small>{value.toFixed(1)}%</small></span><i><em style={{ width: `${Math.min(value, 100)}%` }} /></i></div>)}
          </div>
        </>
      ) : <p className="ua-segmentation__message">{layer.message ?? 'This FortyGuard Premium segmentation layer is not available for the selected hotspot.'}</p>}
    </article>
  )
}

export function UrbanAnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [districts, setDistricts] = useState<Site[]>([])
  const [districtId, setDistrictId] = useState<string | null>(null)
  const [referenceId, setReferenceId] = useState<string | null>(null)
  const [lookbackDays, setLookbackDays] = useState(30)
  const [thresholdF, setThresholdF] = useState(95)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [history, setHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [referenceThermal, setReferenceThermal] = useState<ThermalMapResponse | null>(null)
  const [referenceHistory, setReferenceHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [morphology, setMorphology] = useState<UrbanMorphologyResponse | null>(null)
  const [loadingDistricts, setLoadingDistricts] = useState(true)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [loadingMorphology, setLoadingMorphology] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [morphologyError, setMorphologyError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoadingDistricts(true)
    api.listSites(controller.signal).then((sites) => {
      if (!active || controller.signal.aborted) return
      const urban = filterUrbanDistricts(sites)
      setDistricts(urban)
      const requested = searchParams.get('district')
      const stored = localStorage.getItem(SELECTED_DISTRICT_KEY)
      const preferred = [requested, stored].find((id) => id && urban.some((site) => site.id === id))
      const chosen = preferred ?? urban[0]?.id ?? null
      setDistrictId(chosen)
      const requestedReference = searchParams.get('reference')
      if (requestedReference && requestedReference !== chosen && urban.some((site) => site.id === requestedReference)) setReferenceId(requestedReference)
    }).catch((cause: unknown) => {
      if (!active || isAbortError(cause, controller.signal)) return
      setError(cause instanceof Error ? cause.message : 'Unable to load urban districts.')
    }).finally(() => {
      if (active && !controller.signal.aborted) setLoadingDistricts(false)
    })
    return () => { active = false; controller.abort() }
    // Initial route preference only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!districtId) return
    localStorage.setItem(SELECTED_DISTRICT_KEY, districtId)
    const next: Record<string, string> = { district: districtId }
    if (referenceId && referenceId !== districtId) next.reference = referenceId
    setSearchParams(next, { replace: true })

    const controller = new AbortController()
    let active = true
    setLoadingEvidence(true)
    setError(null)
    setMorphology(null)
    setMorphologyError(null)
    const range = historyRange(lookbackDays)
    const historyPayload = { ...range, thresholdF, granularityMeters: GRANULARITY_METERS as 80 }

    const targetPromise = Promise.allSettled([
      api.generateThermalMap(districtId, { mode: 'site', granularityMeters: GRANULARITY_METERS }, controller.signal),
      api.generateHistoricalHeatBehavior(districtId, historyPayload, controller.signal),
    ])
    const referencePromise = referenceId && referenceId !== districtId
      ? Promise.allSettled([
          api.generateThermalMap(referenceId, { mode: 'site', granularityMeters: GRANULARITY_METERS }, controller.signal),
          api.generateHistoricalHeatBehavior(referenceId, historyPayload, controller.signal),
        ])
      : Promise.resolve(null)

    Promise.all([targetPromise, referencePromise]).then(([targetResults, refResults]) => {
      if (!active || controller.signal.aborted) return
      const [thermalResult, historyResult] = targetResults
      setThermal(thermalResult.status === 'fulfilled' ? thermalResult.value : null)
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : null)
      if (refResults) {
        const [refThermalResult, refHistoryResult] = refResults
        setReferenceThermal(refThermalResult.status === 'fulfilled' ? refThermalResult.value : null)
        setReferenceHistory(refHistoryResult.status === 'fulfilled' ? refHistoryResult.value : null)
      } else {
        setReferenceThermal(null)
        setReferenceHistory(null)
      }
      const targetFailed = targetResults.every((result) => result.status === 'rejected')
      if (targetFailed) setError('HeatShield could not load the selected district analysis evidence.')
    }).finally(() => {
      if (active && !controller.signal.aborted) setLoadingEvidence(false)
    })

    return () => { active = false; controller.abort() }
  }, [districtId, lookbackDays, referenceId, refreshKey, setSearchParams, thresholdF])

  const district = useMemo(() => districts.find((site) => site.id === districtId) ?? null, [districtId, districts])
  const reference = useMemo(() => districts.find((site) => site.id === referenceId) ?? null, [districts, referenceId])
  const candidates = useMemo(() => buildCandidates(history, thermal), [history, thermal])

  useEffect(() => {
    if (!candidates.length) {
      setSelectedCandidateId(null)
      return
    }
    if (!selectedCandidateId || !candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(candidates[0].id)
    }
  }, [candidates, selectedCandidateId])

  const selected = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? candidates[0] ?? null
  const selectedCenter = selected ? polygonCenter(selected.polygon) : null
  const targetThermalReady = thermal?.dataStatus === 'verified'
  const targetHistoryReady = history?.dataStatus === 'verified' || history?.dataStatus === 'partial'
  const referenceThermalReady = referenceThermal?.dataStatus === 'verified'
  const referenceHistoryReady = referenceHistory?.dataStatus === 'verified' || referenceHistory?.dataStatus === 'partial'
  const matched = referenceThermalReady && targetThermalReady && timestampsMatched(thermal?.observedAt, referenceThermal?.observedAt)
  const referenceDelta = matched && thermal?.meanTemperatureC != null && referenceThermal?.meanTemperatureC != null
    ? thermal.meanTemperatureC - referenceThermal.meanTemperatureC
    : null
  const persistenceDelta = targetHistoryReady && referenceHistoryReady && history?.meanPersistenceHours != null && referenceHistory?.meanPersistenceHours != null
    ? history.meanPersistenceHours - referenceHistory.meanPersistenceHours
    : null
  const exceedanceDelta = targetHistoryReady && referenceHistoryReady && history?.meanExceedanceHours != null && referenceHistory?.meanExceedanceHours != null
    ? history.meanExceedanceHours - referenceHistory.meanExceedanceHours
    : null

  const confidenceSignals = [targetThermalReady, targetHistoryReady, Boolean(reference && matched), morphology?.dataStatus === 'verified' || morphology?.dataStatus === 'partial']
  const confidenceCount = confidenceSignals.filter(Boolean).length
  const diagnosticLabel = confidenceCount >= 4 ? 'High evidence depth' : confidenceCount >= 2 ? 'Moderate evidence depth' : 'Screening evidence only'

  const runMorphology = async () => {
    if (!district || !selectedCenter || !thermal?.observedAt || loadingMorphology) return
    setLoadingMorphology(true)
    setMorphologyError(null)
    try {
      const result = await api.generateUrbanMorphology(district.id, {
        latitude: selectedCenter.lat,
        longitude: selectedCenter.lng,
        observedAt: thermal.observedAt,
        granularityMeters: GRANULARITY_METERS,
        includeStreetView: true,
      })
      setMorphology(result)
    } catch (cause) {
      setMorphologyError(cause instanceof Error ? cause.message : 'Could not run FortyGuard urban morphology analysis.')
    } finally {
      setLoadingMorphology(false)
    }
  }

  const synthesis = !selected
    ? 'Select a rankable hotspot after FortyGuard evidence loads.'
    : `${temperature(selected.temperatureC)} at the selected cell is ${signedTemperature(selected.liftC)} relative to the district mean. ${selected.persistenceHours != null ? `Historical persistence is ${hours(selected.persistenceHours)} and exceedance is ${hours(selected.exceedanceHours)} above the configured ${thresholdF}°F threshold.` : 'Historical cell metrics are not fully available.'} ${reference ? (matched && referenceDelta != null ? `The district mean is ${signedTemperature(referenceDelta)} relative to the selected reference area at matched recent observation timing.` : 'A reference area is selected, but recent thermal timestamps are not sufficiently matched for a temperature-intensity comparison.') : 'No external reference area is selected, so this remains an intra-district diagnosis.'}`

  return (
    <AppShell module="urban">
      <div className="topbar">
        <h1 className="topbar__title">Urban Heat Intelligence</h1>
        <div className="topbar__spacer" />
        <div className="module-core-status"><span className="module-core-status__dot" /><span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </div>

      <main className="ua-page">
        <section className="ua-hero panel">
          <div>
            <span className="ua-eyebrow">SCREEN 04 • URBAN ANALYSIS</span>
            <h1>Diagnose why a hotspot deserves action.</h1>
            <p>Move from hotspot detection to an evidence chain: current thermal anomaly, historical persistence, optional matched reference-area comparison, and FortyGuard Premium urban-form segmentation.</p>
          </div>
          <div className="ua-hero__badge"><ScanSearch size={21} /><span><small>DIAGNOSTIC MODE</small><strong>{diagnosticLabel}</strong></span></div>
        </section>

        <section className="ua-controls panel">
          <label><span>Target district</span><div><MapPin size={15} /><select value={districtId ?? ''} onChange={(event) => { const next = event.target.value || null; setDistrictId(next); if (next === referenceId) setReferenceId(null) }} disabled={!districts.length}>{!districts.length && <option value="">No urban districts</option>}{districts.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div></label>
          <label><span>Reference area</span><div><Building2 size={15} /><select value={referenceId ?? ''} onChange={(event) => setReferenceId(event.target.value || null)}><option value="">None / intra-district only</option>{districts.filter((site) => site.id !== districtId).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div></label>
          <label><span>Historical window</span><div><CalendarDays size={15} /><select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></div></label>
          <label><span>Heat threshold</span><div><ThermometerSun size={15} /><select value={thresholdF} onChange={(event) => setThresholdF(Number(event.target.value))}><option value={90}>90°F / 32.2°C</option><option value={95}>95°F / 35.0°C</option><option value={100}>100°F / 37.8°C</option><option value={105}>105°F / 40.6°C</option></select></div></label>
          <button type="button" className="button button--secondary ua-refresh" onClick={refresh} disabled={!districtId || loadingEvidence}><RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} /> Refresh evidence</button>
        </section>

        {loadingDistricts && <StatePanel kind="loading" title="Loading urban districts" detail="Preparing target and reference boundaries for diagnostic analysis…" />}
        {!loadingDistricts && !district && <section className="ua-empty panel"><MapPin size={30} /><div><h2>Create a district first</h2><p>Urban analysis needs a saved target polygon before it can request FortyGuard evidence.</p></div><Link to="/urban/districts" className="button button--primary">Open Districts <ArrowRight size={15} /></Link></section>}

        {district && (
          <>
            <section className="ua-evidence-chain">
              <article className={`ua-chain-step panel ${targetThermalReady ? 'is-ready' : ''}`}><span><ThermometerSun size={18} /></span><div><small>01 • CURRENT SURFACE</small><strong>{targetThermalReady ? temperature(thermal?.meanTemperatureC) : 'Pending'}</strong><b>{targetThermalReady ? `${thermal?.tileCount ?? 0} verified cells` : 'FortyGuard thermal evidence'}</b></div>{targetThermalReady ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</article>
              <article className={`ua-chain-step panel ${targetHistoryReady ? 'is-ready' : ''}`}><span><Clock3 size={18} /></span><div><small>02 • HISTORICAL BEHAVIOR</small><strong>{targetHistoryReady ? hours(history?.maxPersistenceHours) : 'Pending'}</strong><b>{lookbackDays}-day persistence</b></div>{targetHistoryReady ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</article>
              <article className={`ua-chain-step panel ${reference && matched ? 'is-ready' : ''}`}><span><Gauge size={18} /></span><div><small>03 • REFERENCE TEST</small><strong>{reference ? (matched ? signedTemperature(referenceDelta) : 'Unmatched') : 'Optional'}</strong><b>{reference ? reference.name : 'Select comparison area'}</b></div>{reference && matched ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</article>
              <article className={`ua-chain-step panel ${morphology?.dataStatus === 'verified' || morphology?.dataStatus === 'partial' ? 'is-ready' : ''}`}><span><Trees size={18} /></span><div><small>04 • URBAN FORM</small><strong>{morphology ? morphology.dataStatus : 'On demand'}</strong><b>Satellite + street segmentation</b></div>{morphology?.dataStatus === 'verified' || morphology?.dataStatus === 'partial' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</article>
            </section>

            {error && <div className="ua-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="ua-main-grid">
              <article className="ua-map-card panel">
                <div className="ua-card-head"><div><span className="ua-eyebrow">TARGET EVIDENCE</span><h2>{district.name}</h2><small>{targetThermalReady ? `FortyGuard thermal observation • ${observedLabel(thermal?.observedAt)}` : 'Waiting for verified thermal cells'}</small></div><span className="ua-score-chip"><Crosshair size={14} /> {selected ? `${selected.score}/100` : 'No target'}</span></div>
                <AnalysisMap district={district} thermal={thermal} selected={selected} />
              </article>

              <aside className="ua-targets panel">
                <div className="ua-card-head"><div><span className="ua-eyebrow">INVESTIGATION TARGET</span><h2>Choose hotspot</h2><small>Ranked from current anomaly + historical behavior.</small></div><span className="ua-count">{candidates.length}</span></div>
                {loadingEvidence && !thermal ? <div className="ua-loading"><RefreshCw className="spin" size={18} /> Building evidence chain…</div> : candidates.length ? (
                  <div className="ua-target-list">{candidates.slice(0, 8).map((candidate, index) => <button key={candidate.id} type="button" className={candidate.id === selected?.id ? 'is-active' : ''} onClick={() => { setSelectedCandidateId(candidate.id); setMorphology(null); setMorphologyError(null) }}><span className="ua-target-rank">{index + 1}</span><span className="ua-target-copy"><strong>Candidate {candidate.id.slice(0, 8)}</strong><small>{candidate.evidenceFeeds}/3 core hotspot signals</small></span><span className="ua-target-values"><b>{temperature(candidate.temperatureC)}</b><small>{signedTemperature(candidate.liftC)} vs mean</small></span><em>{candidate.score}</em></button>)}</div>
                ) : <div className="ua-empty-mini"><AlertTriangle size={20} /><strong>No rankable hotspot cells</strong><span>{history?.message ?? thermal?.message ?? 'FortyGuard spatial evidence is unavailable.'}</span></div>}
              </aside>
            </section>

            {selected && (
              <section className="ua-diagnostic-grid">
                <article className="ua-diagnosis panel">
                  <div className="ua-card-head"><div><span className="ua-eyebrow">HOTSPOT DIAGNOSIS</span><h2>Evidence at selected cell</h2></div><span className="ua-score-chip ua-score-chip--strong">Score {selected.score}</span></div>
                  <div className="ua-signal-grid">
                    <div><span><ThermometerSun size={16} /> Surface temperature</span><strong>{temperature(selected.temperatureC)}</strong><small>{signedTemperature(selected.liftC)} vs district mean</small></div>
                    <div><span><Clock3 size={16} /> Persistence</span><strong>{hours(selected.persistenceHours)}</strong><small>{lookbackDays}-day FortyGuard layer</small></div>
                    <div><span><BarChart3 size={16} /> Exceedance</span><strong>{hours(selected.exceedanceHours)}</strong><small>Above {thresholdF}°F threshold</small></div>
                    <div><span><Gauge size={16} /> Peak timing</span><strong>{selected.peakHourLocal ?? '—'}</strong><small>Local peak-time evidence</small></div>
                  </div>
                  <div className="ua-synthesis"><Sparkles size={18} /><div><strong>HeatShield evidence synthesis</strong><p>{synthesis}</p></div></div>
                </article>

                <article className="ua-reference panel">
                  <div className="ua-card-head"><div><span className="ua-eyebrow">REFERENCE-AREA TEST</span><h2>{reference ? `${district.name} vs ${reference.name}` : 'Add a comparison area'}</h2></div>{reference && <span className={`ua-status ua-status--${matched ? 'verified' : 'unavailable'}`}>{matched ? 'time matched' : 'not matched'}</span>}</div>
                  {reference ? (
                    <>
                      <div className="ua-reference-table">
                        <div className="ua-reference-table__head"><span>Metric</span><b>Target</b><b>Reference</b><b>Difference</b></div>
                        <div><span>Recent mean surface</span><b>{temperature(thermal?.meanTemperatureC)}</b><b>{temperature(referenceThermal?.meanTemperatureC)}</b><b>{matched ? signedTemperature(referenceDelta) : 'blocked'}</b></div>
                        <div><span>Mean persistence</span><b>{hours(history?.meanPersistenceHours)}</b><b>{hours(referenceHistory?.meanPersistenceHours)}</b><b>{persistenceDelta == null ? '—' : `${persistenceDelta >= 0 ? '+' : ''}${persistenceDelta.toFixed(1)} h`}</b></div>
                        <div><span>Mean exceedance</span><b>{hours(history?.meanExceedanceHours)}</b><b>{hours(referenceHistory?.meanExceedanceHours)}</b><b>{exceedanceDelta == null ? '—' : `${exceedanceDelta >= 0 ? '+' : ''}${exceedanceDelta.toFixed(1)} h`}</b></div>
                      </div>
                      <div className={`ua-reference-note ${matched ? 'is-ready' : ''}`}><ShieldCheck size={16} /><span>{matched ? `Recent thermal timestamps are within 75 minutes (${observedLabel(thermal?.observedAt)} vs ${observedLabel(referenceThermal?.observedAt)}). This supports a time-aligned reference comparison, but the reference area still needs defensible land-use selection before making a formal UHI claim.` : `Recent observations are not sufficiently time-aligned (${observedLabel(thermal?.observedAt)} vs ${observedLabel(referenceThermal?.observedAt)}). HeatShield blocks a temperature-intensity delta instead of comparing mismatched hours.`}</span></div>
                    </>
                  ) : <div className="ua-reference-empty"><Building2 size={26} /><strong>No reference area selected</strong><p>Select another registered district or control polygon above to test whether the target district is warmer under comparable timing.</p></div>}
                </article>
              </section>
            )}

            <section className="ua-morphology panel">
              <div className="ua-morphology__intro">
                <div><span className="ua-eyebrow">FORTYGUARD PREMIUM CONTEXT</span><h2>What urban form surrounds this hotspot?</h2><p>Run satellite and street-view segmentation only for the selected hotspot. This is a credit-aware, on-demand request—not an automatic page load.</p></div>
                <button type="button" className="button button--primary" onClick={runMorphology} disabled={!selectedCenter || !thermal?.observedAt || loadingMorphology}>{loadingMorphology ? <RefreshCw className="spin" size={16} /> : <ScanSearch size={16} />}{loadingMorphology ? 'Running segmentation…' : morphology ? 'Re-run morphology scan' : 'Run morphology scan'}</button>
              </div>

              {morphologyError && <div className="ua-warning"><AlertTriangle size={16} /><span>{morphologyError}</span></div>}
              {morphology ? (
                <>
                  <div className="ua-morphology-metrics">
                    <div><Leaf size={17} /><span><small>Cooling-context coverage</small><strong>{percent(morphology.coolingCoveragePercent, 1)}</strong><b>vegetation / water class keywords</b></span></div>
                    <div><Building2 size={17} /><span><small>Heat-storing context</small><strong>{percent(morphology.heatStoringCoveragePercent, 1)}</strong><b>road / roof / concrete class keywords</b></span></div>
                    <div><Layers3 size={17} /><span><small>Provider requests</small><strong>{morphology.providerRequestCount}</strong><b>{morphology.dataStatus} morphology result</b></span></div>
                    <div><ScanSearch size={17} /><span><small>Dominant classes</small><strong>{morphology.dominantClasses.length}</strong><b>{morphology.dominantClasses.slice(0, 3).join(', ') || 'none returned'}</b></span></div>
                  </div>
                  <div className="ua-segmentation-grid">
                    <SegmentationPanel title="Satellite segmentation" icon="satellite" layer={morphology.satellite} />
                    <SegmentationPanel title="Street-view segmentation" icon="street" layer={morphology.streetView} />
                  </div>
                  <div className="ua-morphology-note"><AlertTriangle size={16} /><span>Coverage summaries are contextual signals derived from provider segmentation class names. They do not prove causation between a surface class and the measured heat anomaly.</span></div>
                </>
              ) : <div className="ua-morphology-empty"><Trees size={30} /><div><strong>Segmentation has not been requested.</strong><span>Use it when a hotspot is important enough to justify deeper urban-form evidence. If your FortyGuard plan does not include Premium segmentation, the app will show the provider limitation without fabricating context.</span></div></div>}
            </section>

            <section className="ua-decision panel">
              <div><span className="ua-eyebrow">DECISION GATE</span><h2>Is this hotspot ready for intervention design?</h2><p>{confidenceCount >= 3 ? 'The evidence chain is strong enough to carry this hotspot into intervention planning, while keeping source limitations visible.' : 'Continue evidence collection before treating this hotspot as an intervention priority. Add a defensible reference area and/or urban-form context.'}</p></div>
              <div className="ua-confidence"><span>{confidenceCount}/4</span><div><strong>{diagnosticLabel}</strong><small>verified evidence stages</small></div></div>
              <Link to={`/urban/interventions?district=${encodeURIComponent(district.id)}${selected ? `&cell=${encodeURIComponent(selected.id)}` : ''}`} className={`button ${confidenceCount >= 2 ? 'button--primary' : 'button--secondary'}`}>Continue to Interventions <ArrowRight size={15} /></Link>
            </section>

            <section className="ua-guardrails panel">
              <ShieldCheck size={19} />
              <div><strong>Scientific interpretation guardrails</strong><p>Current cell lift is an intra-district anomaly. A target-vs-reference delta is shown only when recent thermal observations are time-aligned, and even then the selected reference polygon must be defensible before calling the difference formal urban heat-island intensity. Satellite/street segmentation describes observed context, not causation.</p></div>
              <Link to={`/urban/heat-islands?district=${encodeURIComponent(district.id)}`} className="button button--secondary">Back to Heat Islands</Link>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
