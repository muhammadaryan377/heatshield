import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Crosshair,
  Gauge,
  Hammer,
  Layers3,
  Leaf,
  MapPin,
  Paintbrush,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
  Trees,
  Umbrella,
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
import type {
  UrbanIntervention,
  UrbanInterventionCreate,
  UrbanInterventionStatus,
  UrbanInterventionType,
  UrbanMorphologyResponse,
} from '../types/urban'
import '../urban-interventions.css'

const SELECTED_DISTRICT_KEY = 'heatshield:selected-urban-district'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const GRANULARITY_METERS = 80
const DEFAULT_LOOKBACK_DAYS = 30
const DEFAULT_THRESHOLD_F = 95

type Candidate = {
  id: string
  polygon: Coordinate[]
  temperatureC: number | null
  liftC: number | null
  persistenceHours: number | null
  exceedanceHours: number | null
  peakHourLocal: string | null
  score: number
  evidenceFeeds: number
}

type Recommendation = {
  type: UrbanInterventionType
  title: string
  fit: number
  reason: string
  mechanism: string
  icon: typeof Trees
}

type Draft = {
  type: UrbanInterventionType
  title: string
  owner: string
  targetDate: string
  targetAreaM2: string
  rationale: string
  mechanism: string
  measurementPlan: string
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

function buildCandidates(history: HistoricalHeatBehaviorResponse | null, thermal: ThermalMapResponse | null): Candidate[] {
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
        temperatureC: current,
        liftC: lift,
        persistenceHours: cell.persistenceHours ?? null,
        exceedanceHours: cell.exceedanceHours ?? null,
        peakHourLocal: cell.peakHourLocal ?? null,
        score,
        evidenceFeeds: weighted.length,
      }
    }).sort((a, b) => b.score - a.score)
  }

  if (!thermalReady || !thermal) return []
  return [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC).map((tile) => {
    const lift = meanTemperature == null ? null : tile.temperatureC - meanTemperature
    return {
      id: tile.id,
      polygon: tile.polygon,
      temperatureC: tile.temperatureC,
      liftC: lift,
      persistenceHours: null,
      exceedanceHours: null,
      peakHourLocal: null,
      score: maxLift && lift != null ? Math.round(clamp(Math.max(lift, 0) / maxLift) * 100) : 0,
      evidenceFeeds: 1,
    }
  })
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

function recommendationIcon(type: UrbanInterventionType) {
  if (type === 'tree_canopy') return Trees
  if (type === 'shade_structure') return Umbrella
  if (type === 'cool_surface') return Paintbrush
  if (type === 'green_surface') return Leaf
  if (type === 'cool_roof') return Building2
  return Hammer
}

function interventionLabel(type: UrbanInterventionType) {
  if (type === 'tree_canopy') return 'Tree canopy'
  if (type === 'shade_structure') return 'Shade structure'
  if (type === 'cool_surface') return 'Cool / reflective surface'
  if (type === 'green_surface') return 'Green / permeable surface'
  if (type === 'cool_roof') return 'Cool roof'
  return 'Other intervention'
}

function statusLabel(status: UrbanInterventionStatus) {
  if (status === 'in_progress') return 'In progress'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function buildRecommendations(candidate: Candidate | null, morphology: UrbanMorphologyResponse | null): Recommendation[] {
  if (!candidate) return []
  const heatStoring = morphology?.heatStoringCoveragePercent ?? null
  const cooling = morphology?.coolingCoveragePercent ?? null
  const classes = morphology?.dominantClasses.map((item) => item.toLowerCase()) ?? []
  const roofSignal = classes.some((item) => item.includes('roof') || item.includes('building'))
  const hardscapeSignal = classes.some((item) => ['road', 'asphalt', 'concrete', 'parking', 'pavement'].some((term) => item.includes(term)))
  const heatStrength = clamp(candidate.score / 100)

  const options: Recommendation[] = [
    {
      type: 'tree_canopy',
      title: 'Increase shade-producing canopy',
      fit: Math.round(100 * clamp(0.45 * heatStrength + 0.55 * (cooling == null ? 0.55 : 1 - clamp(cooling / 100)))),
      reason: cooling == null
        ? 'Heat evidence supports evaluating canopy, but segmentation coverage has not been verified yet.'
        : `Cooling-context coverage is ${cooling.toFixed(1)}%; evaluate whether additional canopy is feasible around the selected hotspot.`,
      mechanism: 'Increase direct solar shading and evapotranspirative cooling where site constraints and long-term maintenance allow.',
      icon: Trees,
    },
    {
      type: 'shade_structure',
      title: 'Add targeted shade infrastructure',
      fit: Math.round(100 * clamp(0.55 * heatStrength + 0.45 * (cooling == null ? 0.6 : 1 - clamp(cooling / 100)))),
      reason: 'Useful where rapid pedestrian or public-realm shade is needed and tree establishment is constrained.',
      mechanism: 'Reduce direct solar loading on priority surfaces and people through fixed or modular shade structures.',
      icon: Umbrella,
    },
    {
      type: 'cool_surface',
      title: 'Evaluate a higher-reflectance surface',
      fit: Math.round(100 * clamp(0.45 * heatStrength + 0.55 * (heatStoring == null ? (hardscapeSignal ? 0.75 : 0.5) : clamp(heatStoring / 100)))),
      reason: heatStoring == null
        ? 'Thermal evidence supports a surface-material review; morphology can strengthen material targeting.'
        : `Heat-storing context is ${heatStoring.toFixed(1)}%; review the dominant hardscape before selecting a coating or material.`,
      mechanism: 'Test whether a surface with lower solar absorption can reduce stored daytime heat at the treated area.',
      icon: Paintbrush,
    },
    {
      type: 'green_surface',
      title: 'Convert selected hardscape to green / permeable surface',
      fit: Math.round(100 * clamp(0.5 * heatStrength + 0.5 * (heatStoring == null ? 0.5 : clamp(heatStoring / 100)))),
      reason: 'Consider only where drainage, access, maintenance, utility and land-use constraints permit surface conversion.',
      mechanism: 'Replace a portion of heat-storing hardscape with vegetated or permeable treatment and additional shading potential.',
      icon: Leaf,
    },
  ]

  if (roofSignal) {
    options.push({
      type: 'cool_roof',
      title: 'Evaluate cool-roof treatment',
      fit: Math.round(100 * clamp(0.55 * heatStrength + 0.45 * (heatStoring == null ? 0.7 : clamp(heatStoring / 100)))),
      reason: 'FortyGuard segmentation includes roof/building classes near this target; confirm roof ownership, condition and suitability before design.',
      mechanism: 'Increase roof solar reflectance or otherwise reduce roof heat absorption at a confirmed building surface.',
      icon: Building2,
    })
  }

  return options.sort((a, b) => b.fit - a.fit).slice(0, 5)
}

function interventionDraft(recommendation: Recommendation, candidate: Candidate, district: Site): Draft {
  return {
    type: recommendation.type,
    title: recommendation.title,
    owner: '',
    targetDate: '',
    targetAreaM2: '',
    rationale: `${district.name} candidate ${candidate.id.slice(0, 8)} is ranked ${candidate.score}/100 from the available FortyGuard heat signals. ${recommendation.reason}`,
    mechanism: recommendation.mechanism,
    measurementPlan: 'Lock this FortyGuard observation as the baseline. After implementation, compare the same target area using a new FortyGuard observation under defensibly matched timing and contextual conditions. Report measured change only; do not treat this planning hypothesis as a guaranteed temperature reduction.',
  }
}

function nextStatuses(status: UrbanInterventionStatus): UrbanInterventionStatus[] {
  if (status === 'proposed') return ['approved', 'archived']
  if (status === 'approved') return ['in_progress', 'proposed', 'archived']
  if (status === 'in_progress') return ['completed', 'approved', 'archived']
  if (status === 'completed') return ['archived']
  return []
}

function InterventionMap({
  district,
  thermal,
  selected,
  interventions,
}: {
  district: Site
  thermal: ThermalMapResponse | null
  selected: Candidate | null
  interventions: UrbanIntervention[]
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const thermalRefs = useRef<google.maps.Polygon[]>([])
  const targetRef = useRef<google.maps.Polygon | null>(null)
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
          fillOpacity: 0.02,
          clickable: false,
          zIndex: 30,
        })
        const bounds = new googleInstance.maps.LatLngBounds()
        district.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 36)
        setMapVersion((value) => value + 1)
      })
      .catch((cause: Error) => {
        if (!cancelled) setMapError(cause.message)
      })

    return () => {
      cancelled = true
      boundaryRef.current?.setMap(null)
      targetRef.current?.setMap(null)
      thermalRefs.current.forEach((polygon) => polygon.setMap(null))
      markerRefs.current.forEach((marker) => marker.setMap(null))
      boundaryRef.current = null
      targetRef.current = null
      thermalRefs.current = []
      markerRefs.current = []
      mapRef.current = null
    }
  }, [district.center.lat, district.center.lng, district.id, district.polygon])

  useEffect(() => {
    thermalRefs.current.forEach((polygon) => polygon.setMap(null))
    markerRefs.current.forEach((marker) => marker.setMap(null))
    targetRef.current?.setMap(null)
    thermalRefs.current = []
    markerRefs.current = []
    targetRef.current = null

    const map = mapRef.current
    if (!map || !window.google?.maps) return

    if (thermal?.dataStatus === 'verified' && thermal.tiles.length) {
      const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
      const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))
      thermalRefs.current = thermal.tiles.map((tile) => {
        const color = heatColor(tile.temperatureC, min, max)
        return new google.maps.Polygon({
          map,
          paths: tile.polygon,
          strokeColor: color,
          strokeOpacity: 0.78,
          strokeWeight: 0.6,
          fillColor: color,
          fillOpacity: 0.42,
          clickable: false,
          zIndex: 10,
        })
      })
    }

    if (selected) {
      targetRef.current = new google.maps.Polygon({
        map,
        paths: selected.polygon,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeWeight: 4,
        fillColor: '#d43c48',
        fillOpacity: 0.16,
        clickable: false,
        zIndex: 45,
      })
    }

    markerRefs.current = interventions.filter((item) => item.status !== 'archived').map((item, index) => new google.maps.Marker({
      map,
      position: { lat: item.evidence.latitude, lng: item.evidence.longitude },
      zIndex: 60 + index,
      title: `${item.title} • ${statusLabel(item.status)}`,
      label: { text: `${index + 1}`, color: '#fff', fontWeight: '800', fontSize: '10px' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: item.status === 'completed' ? '#148a67' : item.status === 'in_progress' ? '#177d9b' : '#805b2c',
        fillOpacity: 0.96,
        strokeColor: '#ffffff',
        strokeWeight: 2.2,
      },
    }))
  }, [interventions, mapVersion, selected, thermal])

  return (
    <div className="ui-map">
      {mapsApiKey && !mapError ? <div ref={mapElement} className="ui-map__google" /> : (
        <div className="ui-map__fallback"><Layers3 size={30} /><strong>{mapError ?? 'Google Maps API key is not configured.'}</strong><span>Planning evidence remains available; satellite context requires Google Maps.</span></div>
      )}
      <div className="ui-map__source"><ShieldCheck size={14} /> {thermal?.dataStatus === 'verified' ? `${thermal.tileCount} FortyGuard cells` : 'No synthetic thermal layer'}</div>
      <div className="ui-map__legend"><span>Cooler</span><i /><span>Hotter</span></div>
    </div>
  )
}

export function UrbanInterventionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [districts, setDistricts] = useState<Site[]>([])
  const [districtId, setDistrictId] = useState<string | null>(null)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [history, setHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [interventions, setInterventions] = useState<UrbanIntervention[]>([])
  const [morphology, setMorphology] = useState<UrbanMorphologyResponse | null>(null)
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  const [loadingDistricts, setLoadingDistricts] = useState(true)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [loadingMorphology, setLoadingMorphology] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [morphologyError, setMorphologyError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoadingDistricts(true)
    api.listSites(controller.signal)
      .then((sites) => {
        if (!active || controller.signal.aborted) return
        const urban = filterUrbanDistricts(sites)
        setDistricts(urban)
        const requested = searchParams.get('district')
        const stored = localStorage.getItem(SELECTED_DISTRICT_KEY)
        const preferred = [requested, stored].find((id) => id && urban.some((site) => site.id === id))
        setDistrictId(preferred ?? urban[0]?.id ?? null)
        setSelectedCellId(searchParams.get('cell'))
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load urban districts.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingDistricts(false)
      })
    return () => { active = false; controller.abort() }
    // Initial route preference only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!districtId) return
    localStorage.setItem(SELECTED_DISTRICT_KEY, districtId)
    const controller = new AbortController()
    let active = true
    setLoadingEvidence(true)
    setError(null)
    setMorphology(null)
    setMorphologyError(null)
    setDraft(null)

    const range = historyRange(DEFAULT_LOOKBACK_DAYS)
    Promise.allSettled([
      api.generateThermalMap(districtId, { mode: 'site', granularityMeters: GRANULARITY_METERS }, controller.signal),
      api.generateHistoricalHeatBehavior(districtId, {
        ...range,
        thresholdF: DEFAULT_THRESHOLD_F,
        granularityMeters: GRANULARITY_METERS,
      }, controller.signal),
      api.listUrbanInterventions(districtId, controller.signal),
    ]).then(([thermalResult, historyResult, interventionResult]) => {
      if (!active || controller.signal.aborted) return
      setThermal(thermalResult.status === 'fulfilled' ? thermalResult.value : null)
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : null)
      setInterventions(interventionResult.status === 'fulfilled' ? interventionResult.value : [])
      const failures = [thermalResult, historyResult, interventionResult].filter((result) => result.status === 'rejected')
      if (failures.length === 3) setError('HeatShield could not load FortyGuard evidence or the intervention registry for this district.')
      else if (failures.length) setError('Some intervention-planning evidence is unavailable. Available verified evidence is still shown.')
    }).finally(() => {
      if (active && !controller.signal.aborted) setLoadingEvidence(false)
    })

    return () => { active = false; controller.abort() }
  }, [districtId, refreshKey])

  const district = useMemo(() => districts.find((site) => site.id === districtId) ?? null, [districtId, districts])
  const candidates = useMemo(() => buildCandidates(history, thermal), [history, thermal])
  const selected = useMemo(() => {
    const requested = selectedCellId && candidates.find((candidate) => candidate.id === selectedCellId)
    return requested ?? candidates[0] ?? null
  }, [candidates, selectedCellId])
  const selectedCenter = useMemo(() => selected ? polygonCenter(selected.polygon) : null, [selected])
  const recommendations = useMemo(() => buildRecommendations(selected, morphology), [morphology, selected])
  const activeInterventions = interventions.filter((item) => item.status !== 'archived')
  const completedCount = interventions.filter((item) => item.status === 'completed').length
  const baselineReady = Boolean(
    district
    && selected
    && selectedCenter
    && selected.temperatureC != null
    && thermal?.dataStatus === 'verified'
    && thermal.observedAt
    && thermal.meanTemperatureC != null,
  )

  useEffect(() => {
    if (!districtId || !selected) return
    const next = new URLSearchParams(searchParams)
    next.set('district', districtId)
    next.set('cell', selected.id)
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [districtId, searchParams, selected, setSearchParams])

  const runMorphology = async () => {
    if (!districtId || !selectedCenter || !thermal?.observedAt || loadingMorphology) return
    setLoadingMorphology(true)
    setMorphologyError(null)
    try {
      const result = await api.generateUrbanMorphology(districtId, {
        latitude: selectedCenter.lat,
        longitude: selectedCenter.lng,
        observedAt: thermal.observedAt,
        granularityMeters: GRANULARITY_METERS,
        includeStreetView: true,
      })
      setMorphology(result)
    } catch (cause) {
      setMorphologyError(cause instanceof Error ? cause.message : 'Could not run FortyGuard morphology analysis.')
    } finally {
      setLoadingMorphology(false)
    }
  }

  const chooseRecommendation = (recommendation: Recommendation) => {
    if (!district || !selected) return
    setDraft(interventionDraft(recommendation, selected, district))
  }

  const saveIntervention = async () => {
    if (!draft || !districtId || !selected || !selectedCenter || !thermal?.observedAt || selected.temperatureC == null || thermal.meanTemperatureC == null) return
    setSaving(true)
    setError(null)
    try {
      const payload: UrbanInterventionCreate = {
        type: draft.type,
        title: draft.title.trim(),
        owner: draft.owner.trim() || null,
        targetDate: draft.targetDate || null,
        targetAreaM2: draft.targetAreaM2 ? Number(draft.targetAreaM2) : null,
        rationale: draft.rationale.trim(),
        mechanism: draft.mechanism.trim(),
        measurementPlan: draft.measurementPlan.trim(),
        evidence: {
          source: 'fortyguard',
          cellId: selected.id,
          latitude: selectedCenter.lat,
          longitude: selectedCenter.lng,
          baselineObservedAt: thermal.observedAt,
          baselineTemperatureC: selected.temperatureC,
          districtMeanTemperatureC: thermal.meanTemperatureC,
          anomalyC: selected.temperatureC - thermal.meanTemperatureC,
          historicalStartDate: history?.startDate ?? null,
          historicalEndDate: history?.endDate ?? null,
          thresholdF: history?.thresholdF ?? DEFAULT_THRESHOLD_F,
          persistenceHours: selected.persistenceHours,
          exceedanceHours: selected.exceedanceHours,
          peakHourLocal: selected.peakHourLocal,
          morphologyStatus: morphology?.dataStatus === 'verified' || morphology?.dataStatus === 'partial'
            ? morphology.dataStatus
            : morphology ? 'unavailable' : 'not_requested',
          coolingCoveragePercent: morphology?.coolingCoveragePercent ?? null,
          heatStoringCoveragePercent: morphology?.heatStoringCoveragePercent ?? null,
          dominantClasses: morphology?.dominantClasses ?? [],
        },
      }
      const created = await api.createUrbanIntervention(districtId, payload)
      setInterventions((current) => [created, ...current])
      setDraft(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the intervention plan.')
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (item: UrbanIntervention, status: UrbanInterventionStatus) => {
    if (!districtId || updatingId) return
    setUpdatingId(item.id)
    setError(null)
    try {
      const updated = await api.updateUrbanInterventionStatus(districtId, item.id, status)
      setInterventions((current) => current.map((entry) => entry.id === updated.id ? updated : entry))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update intervention status.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <AppShell module="urban">
      <div className="topbar">
        <h1 className="topbar__title">Urban Heat Intelligence</h1>
        <div className="topbar__spacer" />
        <div className="module-core-status"><span className="module-core-status__dot" /><span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </div>

      <main className="ui-page">
        <section className="ui-hero panel">
          <div>
            <span className="ui-eyebrow">SCREEN 05 • INTERVENTIONS</span>
            <h1>Turn verified heat evidence into a measurable action plan.</h1>
            <p>Design and track cooling interventions without inventing an impact estimate. Every plan locks its FortyGuard baseline so the completed action can be evaluated later with Before / After evidence.</p>
          </div>
          <div className="ui-hero__badge"><ClipboardCheck size={21} /><span><small>DECISION MODE</small><strong>Evidence → action → verification</strong></span></div>
        </section>

        <section className="ui-controls panel">
          <label><span>Target district</span><div><MapPin size={15} /><select value={districtId ?? ''} onChange={(event) => { setDistrictId(event.target.value || null); setSelectedCellId(null) }} disabled={!districts.length}>{!districts.length && <option value="">No urban districts</option>}{districts.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div></label>
          <label><span>Priority hotspot</span><div><Crosshair size={15} /><select value={selected?.id ?? ''} onChange={(event) => { setSelectedCellId(event.target.value || null); setMorphology(null); setDraft(null) }} disabled={!candidates.length}>{!candidates.length && <option value="">No ranked cells</option>}{candidates.slice(0, 12).map((candidate, index) => <option key={candidate.id} value={candidate.id}>#{index + 1} • score {candidate.score} • {temperature(candidate.temperatureC)}</option>)}</select></div></label>
          <div className="ui-control-readout"><span>Historical basis</span><strong>{DEFAULT_LOOKBACK_DAYS} days • {DEFAULT_THRESHOLD_F}°F</strong><small>{history?.dataStatus ?? 'pending'} FortyGuard range</small></div>
          <button type="button" className="button button--secondary" onClick={refresh} disabled={!districtId || loadingEvidence}><RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} /> Refresh evidence</button>
        </section>

        {loadingDistricts && <StatePanel kind="loading" title="Loading urban districts" detail="Preparing intervention planning boundaries…" />}
        {!loadingDistricts && !district && <section className="ui-empty panel"><MapPin size={30} /><div><h2>Create a district first</h2><p>Intervention planning needs a saved district and verified FortyGuard heat evidence.</p></div><Link to="/urban/districts" className="button button--primary">Open Districts <ArrowRight size={15} /></Link></section>}

        {district && (
          <>
            {error && <div className="ui-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="ui-summary-grid">
              <article className="ui-summary panel"><ThermometerSun size={18} /><div><small>Selected surface</small><strong>{temperature(selected?.temperatureC)}</strong><span>{signedTemperature(selected?.liftC)} vs district mean</span></div></article>
              <article className="ui-summary panel"><Clock3 size={18} /><div><small>Historical persistence</small><strong>{hours(selected?.persistenceHours)}</strong><span>{hours(selected?.exceedanceHours)} exceedance</span></div></article>
              <article className="ui-summary panel"><ClipboardCheck size={18} /><div><small>Active interventions</small><strong>{activeInterventions.length}</strong><span>{completedCount} completed</span></div></article>
              <article className={`ui-summary panel ${baselineReady ? 'is-ready' : ''}`}><ShieldCheck size={18} /><div><small>Baseline readiness</small><strong>{baselineReady ? 'Locked-ready' : 'Incomplete'}</strong><span>{thermal?.observedAt ? observedLabel(thermal.observedAt) : 'Awaiting verified observation'}</span></div></article>
            </section>

            <section className="ui-main-grid">
              <article className="ui-map-card panel">
                <div className="ui-card-head"><div><span className="ui-eyebrow">ACTION TARGET</span><h2>{district.name}</h2><small>{thermal?.dataStatus === 'verified' ? `FortyGuard thermal surface • ${observedLabel(thermal.observedAt)}` : 'Waiting for verified thermal evidence'}</small></div><span className="ui-score"><Crosshair size={14} /> {selected ? `${selected.score}/100` : 'No target'}</span></div>
                <InterventionMap district={district} thermal={thermal} selected={selected} interventions={interventions} />
              </article>

              <aside className="ui-baseline panel">
                <div className="ui-card-head"><div><span className="ui-eyebrow">LOCKED BASELINE</span><h2>Evidence before action</h2><small>Saved with every intervention for later verification.</small></div>{baselineReady ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</div>
                <div className="ui-baseline-list">
                  <div><span>Selected cell</span><strong>{selected?.id.slice(0, 12) ?? '—'}</strong></div>
                  <div><span>Surface temperature</span><strong>{temperature(selected?.temperatureC)}</strong></div>
                  <div><span>District mean</span><strong>{temperature(thermal?.meanTemperatureC)}</strong></div>
                  <div><span>Local anomaly</span><strong>{signedTemperature(selected?.liftC)}</strong></div>
                  <div><span>Persistence</span><strong>{hours(selected?.persistenceHours)}</strong></div>
                  <div><span>Peak timing</span><strong>{selected?.peakHourLocal ?? '—'}</strong></div>
                  <div><span>Observation</span><strong>{observedLabel(thermal?.observedAt)}</strong></div>
                </div>
                <div className="ui-baseline-note"><ShieldCheck size={16} /><span>HeatShield does not assign an expected °C reduction here. Impact is measured after implementation with a new FortyGuard observation and defensible comparison conditions.</span></div>
              </aside>
            </section>

            <section className="ui-morphology panel">
              <div><span className="ui-eyebrow">OPTIONAL URBAN-FORM FIT</span><h2>Use morphology to improve intervention targeting.</h2><p>The intervention catalog works from heat evidence alone. Run Premium segmentation only when you want surface and vegetation context to refine which action is most plausible.</p></div>
              <div className="ui-morphology__actions"><button type="button" className="button button--secondary" onClick={runMorphology} disabled={!selectedCenter || !thermal?.observedAt || loadingMorphology}>{loadingMorphology ? <RefreshCw className="spin" size={15} /> : <Layers3 size={15} />}{loadingMorphology ? 'Running morphology…' : morphology ? 'Re-run morphology' : 'Run morphology fit'}</button>{morphology && <span className={`ui-morphology-status ui-morphology-status--${morphology.dataStatus}`}><ShieldCheck size={14} /> {morphology.dataStatus} • {morphology.providerRequestCount} request{morphology.providerRequestCount === 1 ? '' : 's'}</span>}</div>
            </section>
            {morphologyError && <div className="ui-warning"><AlertTriangle size={16} /><span>{morphologyError}</span></div>}

            <section className="ui-recommendations panel">
              <div className="ui-section-head"><div><span className="ui-eyebrow">INTERVENTION CATALOG</span><h2>Evidence-fit options for this hotspot</h2><p>Fit scores prioritize planning relevance only. They are not predicted cooling performance.</p></div><span className="ui-section-chip"><Sparkles size={14} /> {morphology ? 'Heat + morphology context' : 'Heat evidence context'}</span></div>
              {recommendations.length ? <div className="ui-recommendation-grid">{recommendations.map((recommendation) => {
                const Icon = recommendationIcon(recommendation.type)
                return <article key={recommendation.type} className="ui-recommendation"><div className="ui-recommendation__top"><span><Icon size={20} /></span><em>{recommendation.fit}% fit</em></div><h3>{recommendation.title}</h3><p>{recommendation.reason}</p><div className="ui-recommendation__mechanism"><strong>Mechanism to test</strong><span>{recommendation.mechanism}</span></div><button type="button" className="button button--outline-teal" onClick={() => chooseRecommendation(recommendation)} disabled={!baselineReady}>Design intervention</button></article>
              })}</div> : <div className="ui-empty-mini"><AlertTriangle size={20} /><strong>No intervention target yet</strong><span>Load a rankable FortyGuard hotspot first.</span></div>}
            </section>

            {draft && selected && (
              <section className="ui-designer panel">
                <div className="ui-section-head"><div><span className="ui-eyebrow">INTERVENTION DESIGN</span><h2>{interventionLabel(draft.type)}</h2><p>Document the decision, ownership and measurement protocol before approval.</p></div><button type="button" className="button button--secondary" onClick={() => setDraft(null)}>Cancel design</button></div>
                <div className="ui-form-grid">
                  <label><span>Intervention title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                  <label><span>Owner / team</span><input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="e.g. Parks & Public Realm" /></label>
                  <label><span>Target completion date</span><input type="date" value={draft.targetDate} onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })} /></label>
                  <label><span>Target treatment area (m²)</span><input type="number" min="1" value={draft.targetAreaM2} onChange={(event) => setDraft({ ...draft, targetAreaM2: event.target.value })} placeholder="Optional" /></label>
                  <label className="ui-form-wide"><span>Why this intervention here?</span><textarea value={draft.rationale} onChange={(event) => setDraft({ ...draft, rationale: event.target.value })} rows={3} /></label>
                  <label className="ui-form-wide"><span>Mechanism being tested</span><textarea value={draft.mechanism} onChange={(event) => setDraft({ ...draft, mechanism: event.target.value })} rows={2} /></label>
                  <label className="ui-form-wide"><span>Before / After measurement plan</span><textarea value={draft.measurementPlan} onChange={(event) => setDraft({ ...draft, measurementPlan: event.target.value })} rows={3} /></label>
                </div>
                <div className="ui-designer__footer"><div><ShieldCheck size={17} /><span><strong>Baseline will be locked on save.</strong><small>{temperature(selected.temperatureC)} • {observedLabel(thermal?.observedAt)} • cell {selected.id.slice(0, 10)}</small></span></div><button type="button" className="button button--primary" onClick={saveIntervention} disabled={saving || draft.title.trim().length < 3 || draft.rationale.trim().length < 8 || draft.mechanism.trim().length < 8 || draft.measurementPlan.trim().length < 8}>{saving ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}{saving ? 'Saving plan…' : 'Save proposed intervention'}</button></div>
              </section>
            )}

            <section className="ui-register panel">
              <div className="ui-section-head"><div><span className="ui-eyebrow">INTERVENTION REGISTER</span><h2>Track decisions through verification</h2><p>Status changes are persisted server-side; completed actions become inputs for Before / After analysis.</p></div><span className="ui-section-chip"><ClipboardCheck size={14} /> {interventions.length} saved</span></div>
              {interventions.length ? <div className="ui-register-list">{interventions.map((item) => {
                const Icon = recommendationIcon(item.type)
                const transitions = nextStatuses(item.status)
                return <article key={item.id} className={`ui-register-item ui-register-item--${item.status}`}><div className="ui-register-item__icon"><Icon size={20} /></div><div className="ui-register-item__copy"><div><strong>{item.title}</strong><span className={`ui-status ui-status--${item.status}`}>{statusLabel(item.status)}</span></div><small>{interventionLabel(item.type)} • baseline {temperature(item.evidence.baselineTemperatureC)} • anomaly {signedTemperature(item.evidence.anomalyC)}</small><p>{item.rationale}</p><div className="ui-register-meta"><span><MapPin size={13} /> cell {item.evidence.cellId.slice(0, 8)}</span><span><Clock3 size={13} /> {observedLabel(item.evidence.baselineObservedAt)}</span>{item.owner && <span><ClipboardCheck size={13} /> {item.owner}</span>}</div></div><div className="ui-register-actions">{transitions.filter((status) => status !== 'archived').map((status) => <button key={status} type="button" className="button button--secondary" onClick={() => updateStatus(item, status)} disabled={updatingId === item.id}>{status === 'approved' ? <CheckCircle2 size={14} /> : status === 'in_progress' ? <Play size={14} /> : status === 'completed' ? <ClipboardCheck size={14} /> : null}{statusLabel(status)}</button>)}{item.status === 'completed' && <Link to={`/urban/before-after?district=${encodeURIComponent(item.siteId)}&intervention=${encodeURIComponent(item.id)}`} className="button button--primary">Verify outcome <ArrowRight size={14} /></Link>}{transitions.includes('archived') && <button type="button" className="ui-archive" onClick={() => updateStatus(item, 'archived')} disabled={updatingId === item.id} title="Archive intervention"><Archive size={15} /></button>}</div></article>
              })}</div> : <div className="ui-empty-mini"><Hammer size={24} /><strong>No interventions saved yet</strong><span>Select an evidence-fit option above and save the first proposed action.</span></div>}
            </section>

            <section className="ui-guardrail panel"><Gauge size={19} /><div><strong>Scientific guardrail</strong><p>Intervention fit is a planning prioritization layer built from verified heat evidence and optional morphology context. It is not a causal attribution model and does not promise a temperature reduction. Outcome claims belong in Screen 6, after a completed action is measured against its locked baseline.</p></div></section>
          </>
        )}
      </main>
    </AppShell>
  )
}
