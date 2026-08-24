import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Droplets,
  Gauge,
  Layers3,
  Leaf,
  RefreshCw,
  ShieldCheck,
  Sprout,
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
import '../agriculture-irrigation.css'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const DEFAULT_THRESHOLD_C = 35

type LayerKey = Extract<AgricultureFieldLayerType, 'tcm' | 'exceedance' | 'persistence'>

function formatTemp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatHours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function layerLabel(layer: LayerKey) {
  if (layer === 'tcm') return 'Surface temperature'
  if (layer === 'exceedance') return 'Hours above threshold'
  return 'Heat persistence'
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#158f87'
  if (ratio < 0.34) return '#55ad67'
  if (ratio < 0.52) return '#d1be3c'
  if (ratio < 0.7) return '#efa12e'
  if (ratio < 0.86) return '#e86935'
  return '#cb3945'
}

function priority(profile: AgricultureFieldHeatProfile | null) {
  if (!profile || profile.dataStatus === 'unavailable' || profile.dataStatus === 'configuration_required') {
    return { label: 'Awaiting evidence', tone: 'neutral', detail: 'Field-level FortyGuard evidence is required before HeatShield can rank irrigation inspection priority.' }
  }
  const exceedance = profile.maxHoursAboveThreshold ?? 0
  const persistence = profile.maxPersistenceHours ?? 0
  if (exceedance >= 4 || persistence >= 3) {
    return { label: 'Inspect first', tone: 'high', detail: 'Repeated or persistent field heat makes this a first-priority zone for soil-moisture and irrigation-system checks.' }
  }
  if (exceedance >= 2 || persistence >= 1.5) {
    return { label: 'High review', tone: 'watch', detail: 'Verified heat duration supports an elevated irrigation inspection priority.' }
  }
  if ((profile.maxTemperatureC ?? -Infinity) >= profile.thresholdC) {
    return { label: 'Review', tone: 'watch', detail: 'The field reached the configured thermal screening threshold; confirm soil and crop conditions before changing irrigation.' }
  }
  return { label: 'Monitor', tone: 'low', detail: 'Thermal evidence does not currently create a high irrigation-inspection priority.' }
}

function layerRange(layer?: AgricultureFieldHeatLayer) {
  if (!layer || layer.status !== 'verified') return 'Unavailable'
  if (layer.minValue == null || layer.maxValue == null) return `${layer.cells.length} verified cells`
  const suffix = layer.analyticType === 'tcm' ? '°C' : ' h'
  return `${layer.minValue.toFixed(1)}–${layer.maxValue.toFixed(1)}${suffix}`
}

function IrrigationEvidenceMap({ farm, field, profile, activeLayer }: { farm: Site; field: AgricultureField; profile: AgricultureFieldHeatProfile | null; activeLayer: LayerKey }) {
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
        fieldBoundaryRef.current = new googleInstance.maps.Polygon({ map, paths: field.polygon, strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 3, fillColor: '#0c9185', fillOpacity: 0.025, clickable: false, zIndex: 25 })
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
      const polygon = new google.maps.Polygon({ map, paths: cell.polygon, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 0.8, fillColor: color, fillOpacity: 0.6, zIndex: 12 })
      polygon.addListener('click', (event: google.maps.MapMouseEvent) => {
        const suffix = activeLayer === 'tcm' ? '°C' : ' h'
        new google.maps.InfoWindow({
          position: event.latLng ?? field.center,
          content: `<div style="font-family:system-ui;padding:4px 2px"><strong>${cell.value.toFixed(1)}${suffix}</strong><br/><span style="font-size:12px;color:#64736f">Verified FortyGuard ${layerLabel(activeLayer).toLowerCase()} cell</span></div>`,
        }).open({ map, shouldFocus: false })
      })
      return polygon
    })
  }, [activeLayer, field.center, layer, mapVersion])

  return (
    <section className="irrigation-map panel">
      <div className="irrigation-card-head">
        <div>
          <span className="irrigation-eyebrow">FIELD IRRIGATION EVIDENCE</span>
          <h2>{field.name}</h2>
          <small>{field.crop || 'Crop not configured'}{field.growthStage ? ` · ${field.growthStage}` : ''}</small>
        </div>
        <span className={`irrigation-evidence-chip ${layer?.status === 'verified' ? 'is-verified' : ''}`}>
          {layer?.status === 'verified' ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          {layer?.status === 'verified' ? `${layer.cells.length} verified cells` : 'Layer unavailable'}
        </span>
      </div>
      <div className="irrigation-map__canvas">
        {mapsApiKey && !mapError ? <div ref={containerRef} className="irrigation-map__google" /> : (
          <div className="irrigation-map__fallback"><Layers3 size={30} /><strong>{mapError ?? 'Google Maps API key is not configured.'}</strong><span>Evidence can still load, but satellite visualization requires Google Maps.</span></div>
        )}
        <div className="irrigation-map__legend"><div><strong>{layerLabel(activeLayer)}</strong><span>{layerRange(layer)}</span></div><i /><small>Relative scale inside the selected verified layer</small></div>
      </div>
    </section>
  )
}

export function AgricultureIrrigationPlannerPage() {
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
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setProfile(null); setError(cause instanceof Error ? cause.message : 'Unable to load irrigation-planning evidence.') } })
      .finally(() => { if (!controller.signal.aborted) setLoadingEvidence(false) })
    return () => controller.abort()
  }, [farmId, fieldId, thresholdC, granularity, refreshKey])

  const farm = useMemo(() => farms.find((item) => item.id === farmId) ?? null, [farms, farmId])
  const field = useMemo(() => fields.find((item) => item.id === fieldId) ?? null, [fields, fieldId])
  const priorityState = priority(profile)
  const tcmLayer = profile?.layers.find((item) => item.analyticType === 'tcm')
  const exceedanceLayer = profile?.layers.find((item) => item.analyticType === 'exceedance')
  const persistenceLayer = profile?.layers.find((item) => item.analyticType === 'persistence')
  const hottestCells = useMemo(() => {
    if (!tcmLayer || tcmLayer.status !== 'verified') return []
    return [...tcmLayer.cells].sort((a, b) => b.value - a.value).slice(0, 4)
  }, [tcmLayer])
  const verifiedLayers = profile?.layers.filter((item) => item.status === 'verified').length ?? 0

  const agentBrief = useMemo(() => {
    if (!field || !profile || profile.dataStatus === 'configuration_required' || profile.dataStatus === 'unavailable') {
      return 'HeatShield needs verified field heat evidence before it can rank irrigation inspection zones. No water amount or irrigation schedule will be fabricated.'
    }
    const heat = `peak ${formatTemp(profile.maxTemperatureC)} and mean ${formatTemp(profile.meanTemperatureC)}`
    const duration = profile.maxHoursAboveThreshold != null ? `, up to ${formatHours(profile.maxHoursAboveThreshold)} above ${profile.thresholdC.toFixed(1)}°C` : ''
    const persistence = profile.maxPersistenceHours != null ? `, with ${formatHours(profile.maxPersistenceHours)} maximum persistence` : ''
    return `${field.name} shows ${heat}${duration}${persistence}. HeatShield recommends checking soil moisture, irrigation delivery and crop condition first in the hottest verified cells. Use agronomic water-demand and soil data to decide whether, when and how much to irrigate.`
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
      <header className="irrigation-topbar">
        <div><h1>Irrigation Planner</h1><span>Turn verified field heat into inspection priority and timing context without inventing water demand.</span></div>
        <div className="irrigation-topbar__spacer" />
        <div className="irrigation-core-badge"><span /><div><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="irrigation-page">
        <section className="irrigation-controls panel">
          <label><span>FARM</span><select value={farmId ?? ''} onChange={(event) => changeFarm(event.target.value)} disabled={loadingFarms}>{!farms.length && <option value="">No farms</option>}{farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>FIELD</span><select value={fieldId ?? ''} onChange={(event) => changeField(event.target.value)} disabled={loadingFields || !fields.length}>{!fields.length && <option value="">No fields</option>}{fields.map((item) => <option key={item.id} value={item.id}>{item.name}{item.crop ? ` · ${item.crop}` : ''}</option>)}</select></label>
          <label><span>SCREENING THRESHOLD</span><select value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))}>{[30,32,34,35,36,38,40].map((value) => <option key={value} value={value}>{value}°C</option>)}</select><small>User-configured thermal screen</small></label>
          <label><span>FORTYGUARD RESOLUTION</span><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as 60 | 80 | 100)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></label>
          <button type="button" className="irrigation-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={loadingEvidence}><RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} /> Refresh</button>
        </section>

        {error && <div className="irrigation-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

        {!field && !loadingFields ? (
          <section className="irrigation-empty panel"><Droplets size={28} /><div><h2>Add a field before irrigation planning</h2><p>HeatShield needs the actual field polygon so FortyGuard can analyze the area you may irrigate.</p></div><Link to="/agriculture/fields" className="button button--primary">Open Fields</Link></section>
        ) : farm && field ? (
          <>
            <section className="irrigation-kpis">
              <article><span><Droplets size={17} /> Inspection priority</span><strong className={`tone-${priorityState.tone}`}>{priorityState.label}</strong><small>{priorityState.detail}</small></article>
              <article><span><ThermometerSun size={17} /> Peak field temp</span><strong>{formatTemp(profile?.maxTemperatureC)}</strong><small>Verified FortyGuard TCM</small></article>
              <article><span><Gauge size={17} /> Above threshold</span><strong>{formatHours(profile?.maxHoursAboveThreshold)}</strong><small>Maximum cell duration above {thresholdC.toFixed(1)}°C</small></article>
              <article><span><Clock3 size={17} /> Heat persistence</span><strong>{formatHours(profile?.maxPersistenceHours)}</strong><small>Longest continuous verified hot period</small></article>
              <article><span><Leaf size={17} /> Crop context</span><strong>{field.crop || 'Not configured'}</strong><small>{field.growthStage || 'Growth stage not configured'}</small></article>
              <article><span><ShieldCheck size={17} /> Evidence coverage</span><strong>{verifiedLayers}/4 layers</strong><small>{profile?.dataStatus ?? 'Awaiting evidence'}</small></article>
            </section>

            <section className="irrigation-agent panel">
              <div className="irrigation-agent__icon"><Droplets size={21} /></div>
              <div><span className="irrigation-eyebrow">HEATSHIELD IRRIGATION AGENT</span><h2>Inspection-first recommendation</h2><p>{agentBrief}</p></div>
              <div className="irrigation-agent__status"><strong>{priorityState.label}</strong><span>{profile?.peakHourLocal ? `Peak heat near ${profile.peakHourLocal}` : 'Peak timing unavailable'}</span></div>
            </section>

            <section className="irrigation-main-grid">
              <div>
                <div className="irrigation-layer-tabs" role="tablist">
                  {(['tcm','exceedance','persistence'] as LayerKey[]).map((layer) => {
                    const evidence = profile?.layers.find((item) => item.analyticType === layer)
                    return <button key={layer} type="button" className={activeLayer === layer ? 'is-active' : ''} onClick={() => setActiveLayer(layer)}><span>{layerLabel(layer)}</span><small>{evidence?.status === 'verified' ? 'Verified' : 'Unavailable'}</small></button>
                  })}
                </div>
                <IrrigationEvidenceMap farm={farm} field={field} profile={profile} activeLayer={activeLayer} />
              </div>

              <aside className="irrigation-side-stack">
                <section className="panel irrigation-decision-gate">
                  <div className="irrigation-card-head"><div><span className="irrigation-eyebrow">DECISION GATE</span><h2>Water prescription readiness</h2></div><Gauge size={20} /></div>
                  <div className="irrigation-gate-list">
                    <div className={profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial' ? 'is-ready' : ''}><span>{profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><div><strong>Field heat evidence</strong><small>{profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial' ? 'FortyGuard evidence available' : 'Still required'}</small></div></div>
                    <div><span><AlertTriangle size={17} /></span><div><strong>Soil moisture</strong><small>Not connected to HeatShield</small></div></div>
                    <div><span><AlertTriangle size={17} /></span><div><strong>Crop water demand / ET</strong><small>Not supplied by FortyGuard</small></div></div>
                    <div><span><AlertTriangle size={17} /></span><div><strong>Irrigation system constraints</strong><small>Capacity and application rate not configured</small></div></div>
                  </div>
                  <p>HeatShield will rank where to inspect, but it will not prescribe liters, inches, runtime or irrigation frequency until agronomic inputs are connected.</p>
                </section>

                <section className="panel irrigation-priority-zones">
                  <div className="irrigation-card-head"><div><span className="irrigation-eyebrow">INSPECTION QUEUE</span><h2>Hottest verified cells</h2></div><Sprout size={20} /></div>
                  {hottestCells.length ? <div className="irrigation-zone-list">{hottestCells.map((cell, index) => <div key={cell.id}><span>{index + 1}</span><div><strong>Priority cell {index + 1}</strong><small>Check soil moisture, emitter delivery and crop condition</small></div><b>{cell.value.toFixed(1)}°C</b></div>)}</div> : <div className="irrigation-side-empty">No verified temperature cells are available yet.</div>}
                </section>
              </aside>
            </section>

            <section className="irrigation-bottom-grid">
              <article className="panel irrigation-timing-card"><span className="irrigation-eyebrow">THERMAL TIMING CONTEXT</span><h3>{profile?.peakHourLocal ? `Strongest heat near ${profile.peakHourLocal}` : 'Peak heat time unavailable'}</h3><p>Use the verified peak time to plan field checks around the strongest thermal period. Actual irrigation timing must still account for crop practice, soil moisture, wind, application method and local agronomic guidance.</p></article>
              <article className="panel irrigation-evidence-card"><span className="irrigation-eyebrow">EVIDENCE PROVENANCE</span><h3>FortyGuard field profile</h3><div><span>TCM</span><strong>{tcmLayer?.status === 'verified' ? `${tcmLayer.cells.length} cells` : 'Unavailable'}</strong></div><div><span>Exceedance</span><strong>{exceedanceLayer?.status === 'verified' ? `${exceedanceLayer.cells.length} cells` : 'Unavailable'}</strong></div><div><span>Persistence</span><strong>{persistenceLayer?.status === 'verified' ? `${persistenceLayer.cells.length} cells` : 'Unavailable'}</strong></div></article>
              <article className="panel irrigation-boundary-card"><span className="irrigation-eyebrow">SAFETY RAIL</span><h3>Heat evidence ≠ irrigation prescription</h3><p>FortyGuard measures and analyzes heat. It does not provide crop-specific soil-water depletion, evapotranspiration demand, root-zone moisture or irrigation-system application rates. HeatShield keeps those facts separate.</p></article>
            </section>
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
