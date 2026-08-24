import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Droplets,
  Flame,
  Gauge,
  Layers3,
  Map as MapIcon,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sprout,
  SunMedium,
  ThermometerSun,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FieldBoundaryModal } from '../components/agriculture/FieldBoundaryModal'
import { AppShell } from '../components/layout/AppShell'
import { agricultureApi } from '../lib/agricultureApi'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type {
  AgricultureField,
  AgricultureFieldHeatCell,
  AgricultureFieldHeatProfile,
  AgricultureFieldLayerType,
} from '../types/agriculture'
import type { Coordinate, Site, SiteIntelligence, ThermalMapResponse } from '../types/site'
import '../agriculture-fields.css'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const FIELD_STORAGE_KEY = 'heatshield:selected-agriculture-field'
const FARM_STORAGE_KEY = 'heatshield:selected-agriculture-farm'

type LayerMode = 'temperature' | 'exceedance' | 'persistence' | 'peak'

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function temp(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}°C`
}

function number(value?: number | null, digits = 1, suffix = '') {
  return value == null ? '—' : `${value.toFixed(digits)}${suffix}`
}

function observedLabel(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function forecastLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('en-US', { hour: 'numeric' })
}

function polygonAcres(points: Coordinate[]) {
  if (points.length < 3) return 0
  const origin = points[0]
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos((origin.lat * Math.PI) / 180)
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const x1 = (current.lng - origin.lng) * lngScale
    const y1 = (current.lat - origin.lat) * latScale
    const x2 = (next.lng - origin.lng) * lngScale
    const y2 = (next.lat - origin.lat) * latScale
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area / 2) / 4046.8564224
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.001)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#5eb46a'
  if (ratio < 0.52) return '#d6c33a'
  if (ratio < 0.7) return '#f0a02c'
  if (ratio < 0.86) return '#ed6734'
  return '#cf3945'
}

function centerOfPolygon(points: Coordinate[]) {
  const cleaned = points.length > 1 && points[0].lat === points[points.length - 1].lat && points[0].lng === points[points.length - 1].lng
    ? points.slice(0, -1)
    : points
  if (!cleaned.length) return null
  return {
    lat: cleaned.reduce((sum, point) => sum + point.lat, 0) / cleaned.length,
    lng: cleaned.reduce((sum, point) => sum + point.lng, 0) / cleaned.length,
  }
}

function layerByType(profile: AgricultureFieldHeatProfile | null, type: AgricultureFieldLayerType) {
  return profile?.layers.find((layer) => layer.analyticType === type) ?? null
}

function layerTitle(mode: LayerMode) {
  if (mode === 'temperature') return 'Surface Temperature'
  if (mode === 'exceedance') return 'Threshold Exceedance'
  if (mode === 'persistence') return 'Heat Persistence'
  return 'Peak Heat Time'
}

function layerUnit(mode: LayerMode) {
  if (mode === 'temperature') return '°C'
  if (mode === 'peak') return 'UTC hour'
  return 'hours'
}

function cellsForMode(
  mode: LayerMode,
  thermal: ThermalMapResponse | null,
  profile: AgricultureFieldHeatProfile | null,
): AgricultureFieldHeatCell[] {
  if (mode === 'temperature') {
    if (thermal?.dataStatus !== 'verified') return []
    return thermal.tiles.map((tile) => ({ id: tile.id, value: tile.temperatureC, polygon: tile.polygon }))
  }
  const analyticType: AgricultureFieldLayerType = mode === 'peak' ? 'time_of_measure' : mode
  return layerByType(profile, analyticType)?.status === 'verified'
    ? layerByType(profile, analyticType)?.cells ?? []
    : []
}

function formatLayerValue(mode: LayerMode, value: number) {
  if (mode === 'temperature') return `${value.toFixed(1)}°C`
  if (mode === 'peak') return `${Math.round(value) % 24}:00 UTC`
  return `${value.toFixed(1)} h`
}

interface FieldHeatMapProps {
  farm: Site
  field: AgricultureField
  thermal: ThermalMapResponse | null
  profile: AgricultureFieldHeatProfile | null
  mode: LayerMode
  loading: boolean
}

function FieldHeatMap({ farm, field, thermal, profile, mode, loading }: FieldHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const farmBoundaryRef = useRef<google.maps.Polygon | null>(null)
  const fieldBoundaryRef = useRef<google.maps.Polygon | null>(null)
  const cellRefs = useRef<google.maps.Polygon[]>([])
  const markerRefs = useRef<google.maps.Marker[]>([])
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

  const cells = useMemo(() => cellsForMode(mode, thermal, profile), [mode, profile, thermal])
  const range = useMemo(() => {
    if (!cells.length) return null
    const values = cells.map((cell) => cell.value)
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [cells])
  const hottest = useMemo(() => [...cells].sort((a, b) => b.value - a.value).slice(0, 3), [cells])

  useEffect(() => {
    if (!mapsApiKey || !containerRef.current) return
    let cancelled = false
    setMapError(null)
    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return
        const map = new googleInstance.maps.Map(containerRef.current, {
          center: field.center,
          zoom: 17,
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#dce5df',
        })
        mapRef.current = map
        farmBoundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: farm.polygon,
          strokeColor: '#2bc3af',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillOpacity: 0,
          clickable: false,
          zIndex: 18,
        })
        fieldBoundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: field.polygon,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#ffffff',
          fillOpacity: 0.025,
          clickable: false,
          zIndex: 20,
        })
        const bounds = new googleInstance.maps.LatLngBounds()
        field.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 38)
        setMapVersion((value) => value + 1)
      })
      .catch((cause: Error) => setMapError(cause.message))

    return () => {
      cancelled = true
      infoRef.current?.close()
      cellRefs.current.forEach((polygon) => polygon.setMap(null))
      markerRefs.current.forEach((marker) => marker.setMap(null))
      cellRefs.current = []
      markerRefs.current = []
      fieldBoundaryRef.current?.setMap(null)
      farmBoundaryRef.current?.setMap(null)
      fieldBoundaryRef.current = null
      farmBoundaryRef.current = null
      mapRef.current = null
    }
  }, [farm.id, farm.polygon, field.center.lat, field.center.lng, field.id, field.polygon])

  useEffect(() => {
    cellRefs.current.forEach((polygon) => polygon.setMap(null))
    markerRefs.current.forEach((marker) => marker.setMap(null))
    cellRefs.current = []
    markerRefs.current = []
    infoRef.current?.close()
    infoRef.current = null

    const map = mapRef.current
    if (!map || !window.google?.maps || !cells.length || !range) return

    cellRefs.current = cells.map((cell) => {
      const color = heatColor(cell.value, range.min, range.max)
      const polygon = new window.google.maps.Polygon({
        map,
        paths: cell.polygon,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 0.8,
        fillColor: color,
        fillOpacity: 0.56,
        zIndex: 10,
      })
      polygon.addListener('click', (event: google.maps.MapMouseEvent) => {
        infoRef.current?.close()
        const info = new window.google.maps.InfoWindow({
          position: event.latLng ?? centerOfPolygon(cell.polygon) ?? field.center,
          content: `<div class="agri-field-map-popup"><strong>${formatLayerValue(mode, cell.value)}</strong><span>${layerTitle(mode)}</span><small>Verified FortyGuard spatial cell</small></div>`,
          maxWidth: 220,
        })
        info.open({ map, shouldFocus: false })
        infoRef.current = info
      })
      return polygon
    })

    markerRefs.current = hottest.map((cell, index) => {
      const center = centerOfPolygon(cell.polygon)
      if (!center) return null
      const marker = new window.google.maps.Marker({
        map,
        position: center,
        zIndex: 40 + index,
        title: `${layerTitle(mode)} hot zone ${index + 1}`,
        label: {
          text: `${index + 1}`,
          color: '#fff',
          fontWeight: '800',
          fontSize: '11px',
        },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: index === 0 ? 16 : 13,
          fillColor: index === 0 ? '#cb3443' : '#e76639',
          fillOpacity: 0.95,
          strokeColor: '#fff',
          strokeWeight: 2.5,
        },
      })
      marker.addListener('click', () => {
        infoRef.current?.close()
        const info = new window.google.maps.InfoWindow({
          position: center,
          content: `<div class="agri-field-map-popup"><strong>Zone ${index + 1}</strong><span>${formatLayerValue(mode, cell.value)}</span><small>${layerTitle(mode)}</small></div>`,
          maxWidth: 220,
        })
        info.open({ map, shouldFocus: false })
        infoRef.current = info
      })
      return marker
    }).filter((marker): marker is google.maps.Marker => Boolean(marker))
  }, [cells, hottest, mapVersion, mode, range, field.center])

  return (
    <section className="agri-field-map panel">
      <div className="agri-field-map__header">
        <div>
          <span className="agri-field-eyebrow">SPATIAL FIELD EVIDENCE</span>
          <h2>{layerTitle(mode)}</h2>
          <small>{cells.length ? `${cells.length} verified cells` : 'No verified cells for this layer'}</small>
        </div>
        <span className={`agri-field-evidence-chip${cells.length ? ' is-verified' : ''}`}>
          {cells.length ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          {cells.length ? 'FortyGuard verified' : 'Layer unavailable'}
        </span>
      </div>

      <div className="agri-field-map__canvas">
        {mapsApiKey && !mapError ? <div ref={containerRef} className="agri-field-map__google" /> : (
          <div className="agri-field-map__fallback">
            <MapIcon size={30} />
            <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
            <span>Evidence can still load, but the spatial visualization requires Google Maps.</span>
          </div>
        )}

        <div className="agri-field-map__scope"><span className="farm-dot" /> Farm boundary <span className="field-dot" /> Selected field</div>
        {range && (
          <div className="agri-field-map__legend">
            <div><strong>{layerTitle(mode)}</strong><span>{layerUnit(mode)}</span></div>
            <i />
            <div><span>{formatLayerValue(mode, range.min)}</span><span>{formatLayerValue(mode, range.max)}</span></div>
          </div>
        )}
        {loading && <div className="agri-field-map__state"><RefreshCw className="spin" size={18} /><span>Requesting field evidence…</span></div>}
        {!loading && !cells.length && <div className="agri-field-map__state is-warning"><AlertTriangle size={18} /><span>FortyGuard did not return usable spatial cells for this layer. HeatShield is not drawing synthetic cells.</span></div>}
      </div>
    </section>
  )
}

export function AgricultureFieldsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [farms, setFarms] = useState<Site[]>([])
  const [farmId, setFarmId] = useState<string | null>(null)
  const [fields, setFields] = useState<AgricultureField[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [profile, setProfile] = useState<AgricultureFieldHeatProfile | null>(null)
  const [intel, setIntel] = useState<SiteIntelligence | null>(null)
  const [farmsLoading, setFarmsLoading] = useState(true)
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [activeLayer, setActiveLayer] = useState<LayerMode>('temperature')
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [analysisDate, setAnalysisDate] = useState('')
  const [analysisRevision, setAnalysisRevision] = useState(0)

  const farm = useMemo(() => farms.find((item) => item.id === farmId) ?? intel?.site ?? null, [farmId, farms, intel?.site])
  const field = useMemo(() => fields.find((item) => item.id === fieldId) ?? null, [fieldId, fields])

  const refreshAnalysis = useCallback(() => setAnalysisRevision((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setFarmsLoading(true)
    api.listSites(controller.signal)
      .then((items) => {
        if (!active || controller.signal.aborted) return
        setFarms(items)
        const requested = searchParams.get('farm')
        const stored = localStorage.getItem(FARM_STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && items.some((item) => item.id === id))
        setFarmId(preferred ?? items[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load farms.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setFarmsLoading(false)
      })
    return () => { active = false; controller.abort() }
    // Initial farm resolution only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!farmId) {
      setFields([])
      setFieldId(null)
      return
    }
    localStorage.setItem(FARM_STORAGE_KEY, farmId)
    const controller = new AbortController()
    let active = true
    setFieldsLoading(true)
    setError(null)
    agricultureApi.listFields(farmId, controller.signal)
      .then((items) => {
        if (!active || controller.signal.aborted) return
        setFields(items)
        const requested = searchParams.get('field')
        const stored = localStorage.getItem(FIELD_STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && items.some((item) => item.id === id))
        setFieldId(preferred ?? items[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load fields for this farm.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setFieldsLoading(false)
      })
    return () => { active = false; controller.abort() }
  }, [farmId])

  useEffect(() => {
    if (!farmId || !fieldId || !field) {
      setThermal(null)
      setProfile(null)
      setIntel(null)
      return
    }
    localStorage.setItem(FIELD_STORAGE_KEY, fieldId)
    setSearchParams({ farm: farmId, field: fieldId }, { replace: true })

    const controller = new AbortController()
    let active = true
    setAnalysisLoading(true)
    setError(null)
    Promise.allSettled([
      api.generateThermalMap(farmId, { mode: 'custom', polygon: field.polygon, granularityMeters: granularity }, controller.signal),
      agricultureApi.generateFieldHeatProfile(farmId, fieldId, {
        date: analysisDate || null,
        thresholdC,
        granularityMeters: granularity,
      }, controller.signal),
      api.getSiteIntelligence(farmId, controller.signal),
    ]).then(([thermalResult, profileResult, intelResult]) => {
      if (!active || controller.signal.aborted) return
      setThermal(thermalResult.status === 'fulfilled' ? thermalResult.value : null)
      setProfile(profileResult.status === 'fulfilled' ? profileResult.value : null)
      setIntel(intelResult.status === 'fulfilled' ? intelResult.value : null)
      const failures = [thermalResult, profileResult].filter((result) => result.status === 'rejected')
      if (failures.length === 2) setError('HeatShield could not load current or daily FortyGuard field evidence.')
    }).finally(() => {
      if (active && !controller.signal.aborted) setAnalysisLoading(false)
    })

    return () => { active = false; controller.abort() }
  }, [analysisRevision, farmId, field, fieldId, granularity, setSearchParams])

  const runConfiguredAnalysis = () => {
    setProfile(null)
    setAnalysisRevision((value) => value + 1)
  }

  const handleCreated = (created: AgricultureField) => {
    setFields((current) => [created, ...current.filter((item) => item.id !== created.id)])
    setFieldId(created.id)
    setAnalysisRevision((value) => value + 1)
  }

  const deleteSelectedField = async () => {
    if (!farmId || !field) return
    if (!window.confirm(`Delete ${field.name}? This removes the saved field boundary, not the farm.`)) return
    try {
      await agricultureApi.deleteField(farmId, field.id)
      const remaining = fields.filter((item) => item.id !== field.id)
      setFields(remaining)
      setFieldId(remaining[0]?.id ?? null)
      setThermal(null)
      setProfile(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete this field.')
    }
  }

  const forecast = useMemo(
    () => (intel?.forecast ?? []).slice(0, 12).map((point) => ({ time: forecastLabel(point.time), temperatureC: point.temperatureC })),
    [intel?.forecast],
  )
  const currentVerified = thermal?.dataStatus === 'verified'
  const dailyVerified = profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial'
  const layerCompleteness = profile?.layers.filter((layer) => layer.status === 'verified').length ?? 0
  const currentPeak = thermal?.maxTemperatureC
  const currentMean = thermal?.meanTemperatureC
  const hotspotDelta = currentPeak != null && currentMean != null ? currentPeak - currentMean : null
  const fieldAcres = field ? polygonAcres(field.polygon) : null
  const activeCells = useMemo(() => cellsForMode(activeLayer, thermal, profile), [activeLayer, profile, thermal])
  const topCells = useMemo(() => [...activeCells].sort((a, b) => b.value - a.value).slice(0, 5), [activeCells])

  const brief = field && currentVerified
    ? `${field.name} currently peaks at ${temp(currentPeak)} with a ${temp(currentMean)} field mean${hotspotDelta != null ? ` and a ${hotspotDelta.toFixed(1)}°C hotspot lift` : ''}. ${dailyVerified && profile?.maxHoursAboveThreshold != null ? `The daily profile shows up to ${profile.maxHoursAboveThreshold.toFixed(1)} hours above the configured ${thresholdC.toFixed(0)}°C analysis threshold` : 'Daily threshold duration is not verified'}. ${profile?.maxPersistenceHours != null ? `Longest verified persistence is ${profile.maxPersistenceHours.toFixed(1)} hours.` : ''} Prioritize scouting of the hottest spatial cells and use crop/soil controls before changing irrigation quantity.`
    : 'Select a saved field and run FortyGuard analysis. HeatShield will not infer field heat from a single weather point or fabricate missing spatial cells.'

  return (
    <AppShell module="agriculture">
      <header className="agri-field-topbar">
        <div>
          <h1>Field Heat Analysis</h1>
          <span>Analyze real field polygons with current and daily FortyGuard spatial evidence.</span>
        </div>
        <div className="agri-field-topbar__spacer" />
        <div className="agri-field-core-badge"><span /><div><small>INTELLIGENCE CORE</small><strong>FortyGuard field evidence</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="agri-field-page">
        <section className="agri-field-controls panel">
          <label>
            <span>Farm</span>
            <select value={farmId ?? ''} onChange={(event) => { setFarmId(event.target.value || null); setFieldId(null) }} disabled={farmsLoading}>
              {farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>Field</span>
            <select value={fieldId ?? ''} onChange={(event) => setFieldId(event.target.value || null)} disabled={!fields.length || fieldsLoading}>
              {!fields.length && <option value="">No saved fields</option>}
              {fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>Daily profile date</span>
            <input type="date" value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} />
            <small>Blank = selected farm's current local day</small>
          </label>
          <label>
            <span>Analysis threshold</span>
            <div className="agri-field-inline-input"><input type="number" min="-30" max="70" step="1" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /><b>°C</b></div>
            <small>User-configured; not a crop-specific limit</small>
          </label>
          <label>
            <span>Cell size</span>
            <select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as 60 | 80 | 100)}>
              <option value={60}>60 m</option>
              <option value={80}>80 m</option>
              <option value={100}>100 m</option>
            </select>
          </label>
          <div className="agri-field-control-actions">
            <button type="button" className="button button--primary" onClick={runConfiguredAnalysis} disabled={!field || analysisLoading}><RefreshCw size={16} className={analysisLoading ? 'spin' : ''} /> Run analysis</button>
            <button type="button" className="button button--outline-teal" onClick={() => setCreateOpen(true)} disabled={!farm}><Plus size={16} /> Add Field</button>
          </div>
        </section>

        {error && <div className="agri-field-warning"><AlertTriangle size={17} /><span>{error}</span></div>}

        {!farmsLoading && !farms.length && (
          <section className="agri-field-empty panel">
            <MapPin size={28} />
            <div><h2>Add a farm first</h2><p>Fields must live inside a real farm boundary before FortyGuard field analysis can run.</p></div>
            <Link to="/agriculture/farms" className="button button--primary">Open Farms</Link>
          </section>
        )}

        {farm && !fieldsLoading && !fields.length && (
          <section className="agri-field-empty panel">
            <Sprout size={30} />
            <div><span className="agri-field-eyebrow">FIELD BOUNDARY REQUIRED</span><h2>No fields saved for {farm.name}</h2><p>Draw the actual crop field polygon. HeatShield will analyze only that area instead of treating the entire farm as one point.</p></div>
            <button type="button" className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Add First Field</button>
          </section>
        )}

        {farm && field && (
          <>
            <section className="agri-field-identity panel">
              <div className="agri-field-identity__primary">
                <span className="agri-field-eyebrow">SELECTED FIELD</span>
                <h2>{field.name}</h2>
                <p>{farm.name} · {fieldAcres == null ? 'Area pending' : `${fieldAcres.toFixed(1)} mapped acres`}</p>
              </div>
              <div className="agri-field-identity__context"><span>Crop</span><strong>{field.crop || 'Not configured'}</strong><small>Context only</small></div>
              <div className="agri-field-identity__context"><span>Growth stage</span><strong>{field.growthStage || 'Not configured'}</strong><small>Optional agronomic context</small></div>
              <div className="agri-field-identity__evidence">
                <span>Evidence completeness</span>
                <strong className={layerCompleteness >= 3 ? 'is-good' : ''}>{layerCompleteness}/4 daily layers</strong>
                <small>{profile?.cached ? 'Cached provider result' : dailyVerified ? 'Fresh provider workflow' : 'Awaiting provider layers'}</small>
              </div>
              <button type="button" className="agri-field-delete" onClick={deleteSelectedField} title="Delete field boundary"><Trash2 size={16} /></button>
            </section>

            <section className="agri-field-kpis" aria-label="Selected field heat metrics">
              <article><span><ThermometerSun size={17} /> Current Peak</span><strong>{temp(currentPeak)}</strong><small>{currentVerified ? 'Latest verified custom field layer' : 'Awaiting current spatial cells'}</small></article>
              <article><span><Gauge size={17} /> Current Mean</span><strong>{temp(currentMean)}</strong><small>{currentVerified ? `${thermal?.tileCount ?? 0} current cells` : 'No synthetic mean'}</small></article>
              <article><span><Flame size={17} /> Hotspot Lift</span><strong>{hotspotDelta == null ? '—' : `+${hotspotDelta.toFixed(1)}°C`}</strong><small>Peak minus current field mean</small></article>
              <article><span><Activity size={17} /> Max Exceedance</span><strong>{number(profile?.maxHoursAboveThreshold, 1, ' h')}</strong><small>Above configured {thresholdC.toFixed(0)}°C threshold</small></article>
              <article><span><Clock3 size={17} /> Max Persistence</span><strong>{number(profile?.maxPersistenceHours, 1, ' h')}</strong><small>Longest continuous run above threshold</small></article>
              <article><span><SunMedium size={17} /> Peak Heat Time</span><strong>{profile?.peakHourLocal ?? '—'}</strong><small>{profile?.date ? `${profile.date} field profile` : 'Daily timing pending'}</small></article>
            </section>

            <section className="agri-field-layer-tabs panel" aria-label="Field analysis layers">
              <button type="button" className={activeLayer === 'temperature' ? 'is-active' : ''} onClick={() => setActiveLayer('temperature')}><ThermometerSun size={16} /> Temperature <small>current</small></button>
              <button type="button" className={activeLayer === 'exceedance' ? 'is-active' : ''} onClick={() => setActiveLayer('exceedance')}><Activity size={16} /> Threshold Exceedance <small>daily</small></button>
              <button type="button" className={activeLayer === 'persistence' ? 'is-active' : ''} onClick={() => setActiveLayer('persistence')}><Flame size={16} /> Heat Persistence <small>daily</small></button>
              <button type="button" className={activeLayer === 'peak' ? 'is-active' : ''} onClick={() => setActiveLayer('peak')}><Clock3 size={16} /> Peak Heat Time <small>daily</small></button>
            </section>

            <section className="agri-field-main-grid">
              <FieldHeatMap farm={farm} field={field} thermal={thermal} profile={profile} mode={activeLayer} loading={analysisLoading} />

              <aside className="agri-field-summary panel">
                <div className="agri-field-summary__head"><div><span className="agri-field-eyebrow">SELECTED FIELD SUMMARY</span><h2>{field.name}</h2></div><span className={`agri-field-status-pill${dailyVerified ? ' is-verified' : ''}`}>{dailyVerified ? 'Evidence ready' : 'Evidence partial'}</span></div>
                <div className="agri-field-summary__grid">
                  <div><span>Current hottest zone</span><strong>{temp(currentPeak)}</strong></div>
                  <div><span>Daily profile peak</span><strong>{temp(profile?.maxTemperatureC)}</strong></div>
                  <div><span>Mean hours &gt; {thresholdC.toFixed(0)}°C</span><strong>{number(profile?.meanHoursAboveThreshold, 1, ' h')}</strong></div>
                  <div><span>Mean persistence</span><strong>{number(profile?.meanPersistenceHours, 1, ' h')}</strong></div>
                  <div><span>Peak exposure window</span><strong>{profile?.peakHourLocal ?? 'Not verified'}</strong></div>
                  <div><span>Current observed</span><strong>{observedLabel(thermal?.observedAt)}</strong></div>
                </div>
                <div className="agri-field-summary__rule"><AlertTriangle size={16} /><span>{thresholdC.toFixed(0)}°C is an analysis threshold selected in HeatShield. It is not automatically a crop damage threshold.</span></div>
              </aside>
            </section>

            <section className="agri-field-agent panel">
              <div className="agri-field-agent__icon"><Sprout size={22} /></div>
              <div className="agri-field-agent__copy"><span className="agri-field-eyebrow">AGRICULTURE AGENT BRIEF</span><h2>What the verified field evidence says</h2><p>{brief}</p></div>
              <div className="agri-field-agent__evidence">
                <span><ShieldCheck size={14} /> Current field: {currentVerified ? `${thermal?.tileCount ?? 0} cells` : 'unavailable'}</span>
                <span><Layers3 size={14} /> Daily layers: {layerCompleteness}/4</span>
                <span><CalendarDays size={14} /> {profile?.date ?? 'date pending'}</span>
              </div>
            </section>

            <section className="agri-field-lower-grid">
              <article className="agri-field-hotspots panel">
                <div className="agri-field-section-head"><div><span className="agri-field-eyebrow">ZONE COMPARISON</span><h2>Top {layerTitle(activeLayer)} Cells</h2></div><span>{activeCells.length} cells</span></div>
                {topCells.length ? topCells.map((cell, index) => (
                  <div className="agri-field-hotspot-row" key={cell.id}>
                    <span>{index + 1}</span>
                    <div><strong>Field zone {index + 1}</strong><small>Verified spatial cell</small></div>
                    <b>{formatLayerValue(activeLayer, cell.value)}</b>
                  </div>
                )) : <div className="agri-field-no-data">No verified cells for this layer.</div>}
              </article>

              <article className="agri-field-layers panel">
                <div className="agri-field-section-head"><div><span className="agri-field-eyebrow">FORTYGUARD DAILY LAYERS</span><h2>Evidence Provenance</h2></div><span>{profile?.providerRequestCount ?? 0} provider tasks</span></div>
                {(['tcm', 'time_of_measure', 'exceedance', 'persistence'] as AgricultureFieldLayerType[]).map((type) => {
                  const layer = layerByType(profile, type)
                  const title = type === 'tcm' ? 'Daily Temperature' : type === 'time_of_measure' ? 'Peak Heat Time' : type === 'exceedance' ? 'Threshold Exceedance' : 'Persistence'
                  return (
                    <div className="agri-field-layer-row" key={type}>
                      <span className={layer?.status === 'verified' ? 'is-verified' : ''}>{layer?.status === 'verified' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
                      <div><strong>{title}</strong><small>{layer?.activityId ? `Activity ${layer.activityId.slice(0, 12)}…` : layer?.message ?? 'Not requested yet'}</small></div>
                      <b>{layer?.status === 'verified' ? `${layer.cells.length} cells` : 'Unavailable'}</b>
                    </div>
                  )
                })}
              </article>

              <article className="agri-field-forecast panel">
                <div className="agri-field-section-head"><div><span className="agri-field-eyebrow">ATMOSPHERIC CONTEXT</span><h2>Farm Forecast Outlook</h2></div><span>{intel?.conditionSourceLabel ?? 'Context source'}</span></div>
                <div className="agri-field-forecast__note"><AlertTriangle size={14} /> Forecast is site-level atmospheric context, not a predicted FortyGuard field heatmap.</div>
                <div className="agri-field-chart">
                  {forecast.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={forecast} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <XAxis dataKey="time" tickLine={false} axisLine={false} fontSize={11} />
                        <YAxis tickLine={false} axisLine={false} fontSize={11} domain={['dataMin - 2', 'dataMax + 2']} />
                        <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}°C`, 'Temperature']} />
                        <Line type="monotone" dataKey="temperatureC" stroke="currentColor" strokeWidth={2.4} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="agri-field-no-data">Forecast context unavailable.</div>}
                </div>
              </article>

              <article className="agri-field-actions panel">
                <div className="agri-field-section-head"><div><span className="agri-field-eyebrow">DECISION SUPPORT</span><h2>Next Field Actions</h2></div></div>
                <div className="agri-field-action-row"><span><MapPin size={17} /></span><div><strong>Scout the hottest cells first</strong><p>Use the spatial ranking to inspect the exact field areas carrying the highest verified heat.</p></div></div>
                <div className="agri-field-action-row"><span><Droplets size={17} /></span><div><strong>Prioritize irrigation inspection, not quantity</strong><p>Persistence and exceedance can prioritize where to inspect soil moisture and irrigation performance. Water depth still requires agronomic controls.</p></div></div>
                <div className="agri-field-action-row"><span><Clock3 size={17} /></span><div><strong>Plan field work around verified timing</strong><p>{profile?.peakHourLocal ? `Peak field heat is near ${profile.peakHourLocal}; consider cooler work windows when operationally practical.` : 'Peak timing is not verified yet.'}</p></div></div>
                <Link to="/agriculture/crop-heat-stress" className="agri-field-next-link">Continue to Crop Heat Stress <ArrowRight size={15} /></Link>
              </article>
            </section>
          </>
        )}
      </main>

      <FieldBoundaryModal open={createOpen} farm={farm} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </AppShell>
  )
}
