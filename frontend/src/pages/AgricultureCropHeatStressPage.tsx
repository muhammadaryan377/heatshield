import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Droplets,
  Gauge,
  Layers3,
  Leaf,
  RefreshCw,
  ShieldCheck,
  Sprout,
  SunMedium,
  ThermometerSun,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { agricultureApi } from '../lib/agricultureApi'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type { AgricultureField, AgricultureFieldHeatLayer, AgricultureFieldHeatProfile, AgricultureFieldLayerType } from '../types/agriculture'
import type { Site } from '../types/site'
import '../agriculture-crop-heat-stress.css'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const DEFAULT_THRESHOLD_C = 35

type LayerKey = AgricultureFieldLayerType

function formatTemp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatHours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function formatDate(value?: string | null) {
  if (!value) return 'No verified date'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function layerLabel(layer: LayerKey) {
  if (layer === 'tcm') return 'Surface temperature'
  if (layer === 'exceedance') return 'Hours above threshold'
  if (layer === 'persistence') return 'Heat persistence'
  return 'Peak heat time'
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#56ac67'
  if (ratio < 0.52) return '#d3bf39'
  if (ratio < 0.7) return '#efa02d'
  if (ratio < 0.86) return '#ea6636'
  return '#cb3945'
}

function signalTone(profile: AgricultureFieldHeatProfile | null) {
  if (!profile || profile.dataStatus === 'configuration_required' || profile.dataStatus === 'unavailable') return 'neutral'
  const above = (profile.maxHoursAboveThreshold ?? 0) > 0
  const persistent = (profile.maxPersistenceHours ?? 0) > 0
  if (above && persistent) return 'high'
  if (above || (profile.maxTemperatureC ?? -Infinity) >= profile.thresholdC) return 'watch'
  return 'low'
}

function signalLabel(profile: AgricultureFieldHeatProfile | null) {
  const tone = signalTone(profile)
  if (tone === 'high') return 'Priority screening'
  if (tone === 'watch') return 'Elevated screening'
  if (tone === 'low') return 'Routine screening'
  return 'Awaiting evidence'
}

function layerRange(layer?: AgricultureFieldHeatLayer) {
  if (!layer || layer.status !== 'verified') return 'Unavailable'
  if (layer.minValue == null || layer.maxValue == null) return `${layer.cells.length} verified cells`
  const suffix = layer.analyticType === 'tcm' ? '°C' : layer.analyticType === 'time_of_measure' ? ' UTC' : ' h'
  return `${layer.minValue.toFixed(1)}–${layer.maxValue.toFixed(1)}${suffix}`
}

function CropStressMap({ farm, field, profile, activeLayer }: { farm: Site; field: AgricultureField; profile: AgricultureFieldHeatProfile | null; activeLayer: LayerKey }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const cellsRef = useRef<google.maps.Polygon[]>([])
  const fieldBoundaryRef = useRef<google.maps.Polygon | null>(null)
  const farmBoundaryRef = useRef<google.maps.Polygon | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)
  const layer = profile?.layers.find((item) => item.analyticType === activeLayer)

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
        })
        mapRef.current = map
        farmBoundaryRef.current = new googleInstance.maps.Polygon({ map, paths: farm.polygon, strokeColor: '#9fd3c9', strokeOpacity: 0.8, strokeWeight: 1.4, fillOpacity: 0, clickable: false, zIndex: 4 })
        fieldBoundaryRef.current = new googleInstance.maps.Polygon({ map, paths: field.polygon, strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 3, fillColor: '#0c9185', fillOpacity: 0.03, clickable: false, zIndex: 25 })
        const bounds = new googleInstance.maps.LatLngBounds()
        field.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 44)
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => { if (!cancelled) setMapError(error.message) })

    return () => {
      cancelled = true
      cellsRef.current.forEach((cell) => cell.setMap(null))
      cellsRef.current = []
      fieldBoundaryRef.current?.setMap(null)
      farmBoundaryRef.current?.setMap(null)
      fieldBoundaryRef.current = null
      farmBoundaryRef.current = null
      mapRef.current = null
    }
  }, [farm.id, farm.polygon, field.center.lat, field.center.lng, field.id, field.polygon])

  useEffect(() => {
    cellsRef.current.forEach((cell) => cell.setMap(null))
    cellsRef.current = []
    const map = mapRef.current
    if (!map || !window.google?.maps || !layer || layer.status !== 'verified' || !layer.cells.length) return
    const values = layer.cells.map((cell) => cell.value)
    const min = layer.minValue ?? Math.min(...values)
    const max = layer.maxValue ?? Math.max(...values)
    cellsRef.current = layer.cells.map((cell) => {
      const color = heatColor(cell.value, min, max)
      const polygon = new google.maps.Polygon({ map, paths: cell.polygon, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 0.8, fillColor: color, fillOpacity: 0.58, zIndex: 12 })
      polygon.addListener('click', (event: google.maps.MapMouseEvent) => {
        const suffix = activeLayer === 'tcm' ? '°C' : activeLayer === 'time_of_measure' ? ' UTC hour' : ' h'
        new google.maps.InfoWindow({ position: event.latLng ?? field.center, content: `<div style="font-family:system-ui;padding:4px 2px"><strong>${cell.value.toFixed(1)}${suffix}</strong><br/><span style="font-size:12px;color:#64736f">Verified FortyGuard ${layerLabel(activeLayer).toLowerCase()} cell</span></div>` }).open({ map, shouldFocus: false })
      })
      return polygon
    })
  }, [activeLayer, field.center, layer, mapVersion])

  return (
    <section className="crop-stress-map panel">
      <div className="crop-stress-card-head">
        <div><span className="crop-stress-eyebrow">FIELD THERMAL EVIDENCE</span><h2>{field.name}</h2><small>{field.crop || 'Crop not configured'}{field.growthStage ? ` · ${field.growthStage}` : ''}</small></div>
        <span className={`crop-stress-evidence-chip ${layer?.status === 'verified' ? 'is-verified' : ''}`}>{layer?.status === 'verified' ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}{layer?.status === 'verified' ? `${layer.cells.length} verified cells` : 'Layer unavailable'}</span>
      </div>
      <div className="crop-stress-map__canvas">
        {mapsApiKey && !mapError ? <div ref={containerRef} className="crop-stress-map__google" /> : <div className="crop-stress-map__fallback"><Layers3 size={30} /><strong>{mapError ?? 'Google Maps API key is not configured.'}</strong><span>The evidence can still load, but satellite visualization requires Google Maps.</span></div>}
        <div className="crop-stress-map__legend"><div><strong>{layerLabel(activeLayer)}</strong><span>{layerRange(layer)}</span></div><i /><small>Relative scale within this verified field layer</small></div>
      </div>
    </section>
  )
}

export function AgricultureCropHeatStressPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [farms, setFarms] = useState<Site[]>([])
  const [farmId, setFarmId] = useState<string | null>(null)
  const [fields, setFields] = useState<AgricultureField[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [profile, setProfile] = useState<AgricultureFieldHeatProfile | null>(null)
  const [activeLayer, setActiveLayer] = useState<LayerKey>('tcm')
  const [thresholdC, setThresholdC] = useState(DEFAULT_THRESHOLD_C)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [loadingFarms, setLoadingFarms] = useState(true)
  const [loadingFields, setLoadingFields] = useState(false)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        setFarms(loaded)
        const requested = searchParams.get('farm')
        setFarmId(requested && loaded.some((item) => item.id === requested) ? requested : loaded[0]?.id ?? null)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load farms.'))
      .finally(() => setLoadingFarms(false))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!farmId) { setFields([]); setFieldId(null); setProfile(null); return }
    const controller = new AbortController()
    setLoadingFields(true)
    setError(null)
    agricultureApi.listFields(farmId, controller.signal)
      .then((loaded) => {
        setFields(loaded)
        const requested = searchParams.get('field')
        const preferred = requested && loaded.some((item) => item.id === requested) ? requested : loaded[0]?.id ?? null
        setFieldId(preferred)
        const next = new URLSearchParams(searchParams)
        next.set('farm', farmId)
        if (preferred) next.set('field', preferred); else next.delete('field')
        setSearchParams(next, { replace: true })
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load fields.'))
      .finally(() => setLoadingFields(false))
    return () => controller.abort()
  }, [farmId])

  useEffect(() => {
    if (!farmId || !fieldId) { setProfile(null); return }
    const controller = new AbortController()
    setLoadingEvidence(true)
    setError(null)
    agricultureApi.generateFieldHeatProfile(farmId, fieldId, { thresholdC, granularityMeters: granularity }, controller.signal)
      .then(setProfile)
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setProfile(null); setError(cause instanceof Error ? cause.message : 'Unable to load crop heat screening evidence.') } })
      .finally(() => { if (!controller.signal.aborted) setLoadingEvidence(false) })
    return () => controller.abort()
  }, [farmId, fieldId, thresholdC, granularity, refreshKey])

  const farm = useMemo(() => farms.find((item) => item.id === farmId) ?? null, [farms, farmId])
  const field = useMemo(() => fields.find((item) => item.id === fieldId) ?? null, [fields, fieldId])
  const tone = signalTone(profile)
  const activeEvidenceLayers = profile?.layers.filter((layer) => layer.status === 'verified').length ?? 0
  const tcmLayer = profile?.layers.find((layer) => layer.analyticType === 'tcm')
  const exceedanceLayer = profile?.layers.find((layer) => layer.analyticType === 'exceedance')
  const persistenceLayer = profile?.layers.find((layer) => layer.analyticType === 'persistence')
  const peakLayer = profile?.layers.find((layer) => layer.analyticType === 'time_of_measure')

  const priorityMessage = useMemo(() => {
    if (!field || !profile || profile.dataStatus === 'unavailable' || profile.dataStatus === 'configuration_required') return 'HeatShield needs verified field-level FortyGuard evidence before it can produce a thermal crop-stress screening priority.'
    const pieces: string[] = []
    if ((profile.maxHoursAboveThreshold ?? 0) > 0) pieces.push(`parts of the field were above ${profile.thresholdC.toFixed(1)}°C for up to ${profile.maxHoursAboveThreshold?.toFixed(1)} hours`)
    if ((profile.maxPersistenceHours ?? 0) > 0) pieces.push(`the longest continuous hot spell reached ${profile.maxPersistenceHours?.toFixed(1)} hours`)
    if (profile.peakHourLocal) pieces.push(`the strongest thermal period was near ${profile.peakHourLocal}`)
    const evidence = pieces.length ? pieces.join(', ') : `the verified field peak was ${formatTemp(profile.maxTemperatureC)}`
    return `${field.crop || 'This field'}${field.growthStage ? ` at ${field.growthStage}` : ''} is being screened against thermal evidence only: ${evidence}. Scout the hottest verified zone, then combine this evidence with crop-specific agronomic thresholds and soil-moisture observations before irrigation or treatment decisions.`
  }, [field, profile])

  const changeFarm = (value: string) => { setFarmId(value); setFieldId(null); setProfile(null) }
  const changeField = (value: string) => {
    setFieldId(value); setProfile(null)
    const next = new URLSearchParams(searchParams)
    if (farmId) next.set('farm', farmId)
    next.set('field', value)
    setSearchParams(next, { replace: true })
  }

  return (
    <AppShell module="agriculture">
      <header className="crop-stress-topbar">
        <div><h1>Crop Heat Stress</h1><span>Screen crop areas using field-specific FortyGuard heat evidence, not a single weather point.</span></div>
        <div className="crop-stress-topbar__spacer" />
        <div className="crop-stress-core-badge"><span /><div><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="crop-stress-page">
        <section className="crop-stress-controls panel">
          <label><span>FARM</span><select value={farmId ?? ''} onChange={(event) => changeFarm(event.target.value)} disabled={loadingFarms}>{!farms.length && <option value="">No farms</option>}{farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>FIELD / CROP</span><select value={fieldId ?? ''} onChange={(event) => changeField(event.target.value)} disabled={loadingFields || !fields.length}>{!fields.length && <option value="">No fields configured</option>}{fields.map((item) => <option key={item.id} value={item.id}>{item.name}{item.crop ? ` · ${item.crop}` : ''}</option>)}</select></label>
          <label><span>THERMAL SCREENING THRESHOLD</span><div className="crop-stress-threshold-input"><input type="number" min={20} max={50} step={0.5} value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value) || DEFAULT_THRESHOLD_C)} /><b>°C</b></div><small>User-configured screening value — not a crop damage threshold.</small></label>
          <label><span>FORTYGUARD RESOLUTION</span><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as 60 | 80 | 100)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></label>
          <button type="button" className="crop-stress-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={loadingEvidence || !fieldId}><RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} /> {loadingEvidence ? 'Analyzing' : 'Refresh evidence'}</button>
        </section>

        {error && <div className="crop-stress-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

        {!field && !loadingFields ? <section className="crop-stress-empty panel"><Sprout size={28} /><div><span className="crop-stress-eyebrow">FIELD CONTEXT REQUIRED</span><h2>Add a field before running crop heat screening</h2><p>Crop Heat Stress works on a saved field polygon so FortyGuard can analyze the exact production area.</p></div><Link to="/agriculture/fields" className="button button--primary">Open Fields <ArrowRight size={15} /></Link></section> : farm && field ? <>
          <section className="crop-stress-kpis">
            <article><span><ThermometerSun size={17} /> Peak field temperature</span><strong>{formatTemp(profile?.maxTemperatureC)}</strong><small>{profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial' ? 'FortyGuard TCM field evidence' : 'Awaiting verified evidence'}</small></article>
            <article><span><Gauge size={17} /> Mean field temperature</span><strong>{formatTemp(profile?.meanTemperatureC)}</strong><small>{tcmLayer?.status === 'verified' ? `${tcmLayer.cells.length} spatial cells` : 'No TCM cells available'}</small></article>
            <article><span><SunMedium size={17} /> Max time above threshold</span><strong>{formatHours(profile?.maxHoursAboveThreshold)}</strong><small>{exceedanceLayer?.status === 'verified' ? `Above ${thresholdC.toFixed(1)}°C screening line` : 'Exceedance layer unavailable'}</small></article>
            <article><span><Activity size={17} /> Longest hot persistence</span><strong>{formatHours(profile?.maxPersistenceHours)}</strong><small>{persistenceLayer?.status === 'verified' ? 'Verified continuous heat duration' : 'Persistence layer unavailable'}</small></article>
            <article><span><CalendarDays size={17} /> Peak heat timing</span><strong>{profile?.peakHourLocal ?? '—'}</strong><small>{peakLayer?.status === 'verified' ? `${formatDate(profile?.date)} · local field time` : 'Peak timing unavailable'}</small></article>
            <article className={`crop-stress-priority crop-stress-priority--${tone}`}><span><Leaf size={17} /> HeatShield screening priority</span><strong>{signalLabel(profile)}</strong><small>Operational screening, not agronomic diagnosis</small></article>
          </section>

          <section className="crop-stress-main-grid">
            <div>
              <div className="crop-stress-layer-tabs" role="tablist" aria-label="FortyGuard field layers">{(['tcm', 'exceedance', 'persistence', 'time_of_measure'] as LayerKey[]).map((key) => { const item = profile?.layers.find((layer) => layer.analyticType === key); return <button key={key} type="button" className={activeLayer === key ? 'is-active' : ''} onClick={() => setActiveLayer(key)}><span>{layerLabel(key)}</span><small>{item?.status === 'verified' ? 'Verified' : 'Unavailable'}</small></button> })}</div>
              <CropStressMap farm={farm} field={field} profile={profile} activeLayer={activeLayer} />
            </div>

            <aside className="crop-stress-insights panel">
              <div className="crop-stress-card-head"><div><span className="crop-stress-eyebrow">AGRICULTURE AGENT</span><h2>Stress Screening Brief</h2></div><span className={`crop-stress-priority-pill crop-stress-priority-pill--${tone}`}>{signalLabel(profile)}</span></div>
              <p className="crop-stress-agent-copy">{priorityMessage}</p>
              <div className="crop-stress-context-grid"><div><span>Crop context</span><strong>{field.crop || 'Not configured'}</strong></div><div><span>Growth stage</span><strong>{field.growthStage || 'Not configured'}</strong></div><div><span>Evidence layers</span><strong>{activeEvidenceLayers}/4 verified</strong></div><div><span>Provider requests</span><strong>{profile?.providerRequestCount ?? '—'}</strong></div></div>
              <div className="crop-stress-action-list">
                <article><span><CheckCircle2 size={17} /></span><div><strong>Scout the hottest verified zone</strong><p>Use the spatial TCM layer to decide where field inspection should start instead of checking a random location.</p></div></article>
                <article><span><Droplets size={17} /></span><div><strong>Cross-check irrigation condition</strong><p>Review soil moisture, irrigation records and crop guidance before changing water timing or quantity.</p></div></article>
                <article><span><Activity size={17} /></span><div><strong>Check persistence, not only peak</strong><p>A short hot spike and a persistent hot zone can require different operational attention.</p></div></article>
              </div>
              <div className="crop-stress-caution"><AlertTriangle size={16} /><span>FortyGuard provides thermal evidence. Crop damage thresholds, plant-water demand and treatment decisions require crop-specific agronomic configuration or external agronomy data.</span></div>
            </aside>
          </section>

          <section className="crop-stress-bottom-grid">
            <article className="panel crop-stress-evidence-table">
              <div className="crop-stress-card-head"><div><span className="crop-stress-eyebrow">FORTYGUARD LAYERS</span><h2>Evidence Provenance</h2></div><ShieldCheck size={20} /></div>
              <div className="crop-stress-table-head"><span>Layer</span><span>Status</span><span>Range</span><span>Activity ID</span></div>
              {(['tcm', 'exceedance', 'persistence', 'time_of_measure'] as LayerKey[]).map((key) => { const item = profile?.layers.find((layer) => layer.analyticType === key); return <div className="crop-stress-table-row" key={key}><span><strong>{layerLabel(key)}</strong><small>{key === 'tcm' ? 'Spatial temperature' : key === 'exceedance' ? `Threshold ${thresholdC.toFixed(1)}°C` : key === 'persistence' ? 'Continuous hot duration' : 'Hottest local period'}</small></span><span className={item?.status === 'verified' ? 'verified' : 'unavailable'}>{item?.status === 'verified' ? 'Verified' : 'Unavailable'}</span><span>{layerRange(item)}</span><span>{item?.activityId ? `${item.activityId.slice(0, 8)}…` : '—'}</span></div> })}
            </article>

            <article className="panel crop-stress-next"><div className="crop-stress-card-head"><div><span className="crop-stress-eyebrow">DECISION BOUNDARY</span><h2>What this screen can decide</h2></div><Leaf size={20} /></div><ul><li><CheckCircle2 size={15} /> Which field zones are hottest?</li><li><CheckCircle2 size={15} /> How long was the screening threshold exceeded?</li><li><CheckCircle2 size={15} /> Is heat persistent or only a short peak?</li><li><CheckCircle2 size={15} /> When did the strongest thermal period occur?</li><li className="is-limited"><AlertTriangle size={15} /> It does not diagnose crop injury or prescribe liters of irrigation water.</li></ul><Link to="/agriculture/irrigation" className="crop-stress-next-link">Continue to Irrigation Planner <ArrowRight size={14} /></Link></article>
          </section>
        </> : null}
      </main>
    </AppShell>
  )
}
