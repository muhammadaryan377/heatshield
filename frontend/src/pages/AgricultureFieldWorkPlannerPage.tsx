import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  SunMedium,
  ThermometerSun,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { agricultureApi } from '../lib/agricultureApi'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type { AgricultureField, AgricultureFieldHeatLayer, AgricultureFieldHeatProfile } from '../types/agriculture'
import type { Coordinate, Site, SiteIntelligence, Worker } from '../types/site'
import '../agriculture-field-work.css'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const DEFAULT_THRESHOLD_C = 35

function formatTemp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatHours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function formatTime(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  if (polygon.length < 3) return false
  let inside = false
  let j = polygon.length - 1
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    const crosses = (current.lat > point.lat) !== (previous.lat > point.lat)
    if (crosses) {
      const denominator = previous.lat - current.lat
      if (Math.abs(denominator) > 1e-12) {
        const lng = ((previous.lng - current.lng) * (point.lat - current.lat)) / denominator + current.lng
        if (point.lng < lng) inside = !inside
      }
    }
    j = i
  }
  return inside
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

type WindowTone = 'preferred' | 'watch' | 'caution'

interface ForecastWindow {
  time: string
  temperatureC: number
  tone: WindowTone
  label: string
}

function rankForecast(intel: SiteIntelligence | null): ForecastWindow[] {
  const points = (intel?.forecast ?? []).slice(0, 10)
  if (!points.length) return []
  const values = points.map((point) => point.temperatureC)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 0.1)
  return points.map((point) => {
    const relative = (point.temperatureC - min) / span
    if (relative <= 0.33) return { time: point.time, temperatureC: point.temperatureC, tone: 'preferred', label: 'Cooler candidate' }
    if (relative <= 0.66) return { time: point.time, temperatureC: point.temperatureC, tone: 'watch', label: 'Review conditions' }
    return { time: point.time, temperatureC: point.temperatureC, tone: 'caution', label: 'Warmer period' }
  })
}

function FieldWorkMap({ farm, field, tcm, workers }: { farm: Site; field: AgricultureField; tcm?: AgricultureFieldHeatLayer; workers: Worker[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const cellsRef = useRef<google.maps.Polygon[]>([])
  const workersRef = useRef<google.maps.Marker[]>([])
  const boundariesRef = useRef<google.maps.Polygon[]>([])
  const [mapVersion, setMapVersion] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

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
        boundariesRef.current = [
          new googleInstance.maps.Polygon({ map, paths: farm.polygon, strokeColor: '#9fd3c9', strokeOpacity: 0.85, strokeWeight: 1.4, fillOpacity: 0, clickable: false, zIndex: 3 }),
          new googleInstance.maps.Polygon({ map, paths: field.polygon, strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 3, fillColor: '#0a8f83', fillOpacity: 0.04, clickable: false, zIndex: 25 }),
        ]
        const bounds = new googleInstance.maps.LatLngBounds()
        field.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 44)
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => { if (!cancelled) setMapError(error.message) })

    return () => {
      cancelled = true
      cellsRef.current.forEach((cell) => cell.setMap(null))
      workersRef.current.forEach((marker) => marker.setMap(null))
      boundariesRef.current.forEach((boundary) => boundary.setMap(null))
      cellsRef.current = []
      workersRef.current = []
      boundariesRef.current = []
      mapRef.current = null
    }
  }, [farm.id, farm.polygon, field.center.lat, field.center.lng, field.id, field.polygon])

  useEffect(() => {
    cellsRef.current.forEach((cell) => cell.setMap(null))
    workersRef.current.forEach((marker) => marker.setMap(null))
    cellsRef.current = []
    workersRef.current = []
    const map = mapRef.current
    if (!map || !window.google?.maps) return

    if (tcm?.status === 'verified' && tcm.cells.length) {
      const values = tcm.cells.map((cell) => cell.value)
      const min = tcm.minValue ?? Math.min(...values)
      const max = tcm.maxValue ?? Math.max(...values)
      cellsRef.current = tcm.cells.map((cell) => {
        const color = heatColor(cell.value, min, max)
        return new google.maps.Polygon({ map, paths: cell.polygon, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 0.8, fillColor: color, fillOpacity: 0.56, zIndex: 12 })
      })
    }

    workersRef.current = workers.map((worker) => new google.maps.Marker({
      map,
      position: worker.coordinate,
      title: `${worker.name} · ${worker.task || worker.role}`,
      zIndex: 40,
      label: { text: worker.initials || worker.name.slice(0, 1), color: '#ffffff', fontSize: '10px', fontWeight: '800' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: '#176f68', fillOpacity: 0.96, strokeColor: '#ffffff', strokeWeight: 2.5 },
    }))
  }, [mapVersion, tcm, workers])

  return (
    <section className="field-work-map panel">
      <div className="field-work-card-head">
        <div><span className="field-work-eyebrow">FIELD + CREW POSITION</span><h2>{field.name}</h2><small>{tcm?.status === 'verified' ? `${tcm.cells.length} verified FortyGuard temperature cells` : 'Field boundary shown; thermal layer unavailable'}</small></div>
        <span className={`field-work-chip ${tcm?.status === 'verified' ? 'is-verified' : ''}`}>{tcm?.status === 'verified' ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}{workers.length} mapped worker{workers.length === 1 ? '' : 's'} inside field</span>
      </div>
      <div className="field-work-map__canvas">
        {mapsApiKey && !mapError ? <div ref={containerRef} className="field-work-map__google" /> : <div className="field-work-map__fallback"><Layers3 size={30} /><strong>{mapError ?? 'Google Maps API key is not configured.'}</strong><span>Field planning still works, but spatial visualization requires Google Maps.</span></div>}
        <div className="field-work-map__legend"><span>Cooler relative field cells</span><i /><span>Hotter relative field cells</span></div>
      </div>
    </section>
  )
}

export function AgricultureFieldWorkPlannerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [farms, setFarms] = useState<Site[]>([])
  const [farmId, setFarmId] = useState<string | null>(null)
  const [fields, setFields] = useState<AgricultureField[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [intel, setIntel] = useState<SiteIntelligence | null>(null)
  const [profile, setProfile] = useState<AgricultureFieldHeatProfile | null>(null)
  const [thresholdC, setThresholdC] = useState(DEFAULT_THRESHOLD_C)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [loading, setLoading] = useState(true)
  const [loadingField, setLoadingField] = useState(false)
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
      .finally(() => setLoading(false))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!farmId) { setFields([]); setFieldId(null); setWorkers([]); setIntel(null); return }
    const controller = new AbortController()
    setError(null)
    Promise.all([
      agricultureApi.listFields(farmId, controller.signal),
      api.listWorkers(farmId, controller.signal),
      api.getSiteIntelligence(farmId, controller.signal),
    ])
      .then(([loadedFields, loadedWorkers, loadedIntel]) => {
        setFields(loadedFields)
        setWorkers(loadedWorkers)
        setIntel(loadedIntel)
        const requested = searchParams.get('field')
        const preferred = requested && loadedFields.some((item) => item.id === requested) ? requested : loadedFields[0]?.id ?? null
        setFieldId(preferred)
        const next = new URLSearchParams(searchParams)
        next.set('farm', farmId)
        if (preferred) next.set('field', preferred); else next.delete('field')
        setSearchParams(next, { replace: true })
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load farm work-planning context.') })
    return () => controller.abort()
  }, [farmId, refreshKey])

  useEffect(() => {
    if (!farmId || !fieldId) { setProfile(null); return }
    const controller = new AbortController()
    setLoadingField(true)
    agricultureApi.generateFieldHeatProfile(farmId, fieldId, { thresholdC, granularityMeters: granularity }, controller.signal)
      .then(setProfile)
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setProfile(null); setError(cause instanceof Error ? cause.message : 'Unable to load field heat evidence.') } })
      .finally(() => { if (!controller.signal.aborted) setLoadingField(false) })
    return () => controller.abort()
  }, [farmId, fieldId, thresholdC, granularity, refreshKey])

  const farm = useMemo(() => farms.find((item) => item.id === farmId) ?? null, [farms, farmId])
  const field = useMemo(() => fields.find((item) => item.id === fieldId) ?? null, [fields, fieldId])
  const workersInsideField = useMemo(() => field ? workers.filter((worker) => pointInPolygon(worker.coordinate, field.polygon)) : [], [field, workers])
  const forecastWindows = useMemo(() => rankForecast(intel), [intel])
  const bestWindow = useMemo(() => forecastWindows.filter((window) => window.tone === 'preferred').sort((a, b) => a.temperatureC - b.temperatureC)[0] ?? null, [forecastWindows])
  const warmestWindow = useMemo(() => [...forecastWindows].sort((a, b) => b.temperatureC - a.temperatureC)[0] ?? null, [forecastWindows])
  const tcm = profile?.layers.find((layer) => layer.analyticType === 'tcm')
  const heavyWorkers = workersInsideField.filter((worker) => worker.workIntensity === 'heavy').length
  const directSunWorkers = workersInsideField.filter((worker) => worker.sunExposure === 'direct').length
  const evidenceReady = profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial'

  const plannerBrief = useMemo(() => {
    if (!field || !profile || !evidenceReady) return 'Verified field-level heat evidence is required before HeatShield can rank work windows for this field.'
    const peak = profile.peakHourLocal ? `Field heat peaks near ${profile.peakHourLocal}.` : 'Peak field-heat time is not available.'
    const persistence = profile.maxPersistenceHours != null ? ` Longest verified persistence is ${profile.maxPersistenceHours.toFixed(1)} h.` : ''
    const crew = workersInsideField.length ? ` ${workersInsideField.length} worker${workersInsideField.length === 1 ? ' is' : 's are'} currently mapped inside the field.` : ' No workers are currently mapped inside this field polygon.'
    const atmosphere = bestWindow ? ` The coolest relative atmospheric forecast candidate in the loaded horizon is ${formatTime(bestWindow.time)} at ${formatTemp(bestWindow.temperatureC)}.` : ' Atmospheric forecast ranking is unavailable.'
    return `${peak}${persistence}${crew}${atmosphere} Treat this as a planning screen: supervisor rules, workload, hydration, breaks and local occupational requirements still control the final work decision.`
  }, [bestWindow, evidenceReady, field, profile, workersInsideField.length])

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
      <header className="field-work-topbar">
        <div><h1>Field Work Planner</h1><span>Rank field-work timing with exact field heat evidence, crew position and atmospheric context.</span></div>
        <div className="field-work-topbar__spacer" />
        <div className="field-work-core-badge"><span /><div><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="field-work-page">
        <section className="field-work-controls panel">
          <label><span>FARM</span><select value={farmId ?? ''} onChange={(event) => changeFarm(event.target.value)} disabled={loading}>{!farms.length && <option value="">No farms</option>}{farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>FIELD</span><select value={fieldId ?? ''} onChange={(event) => changeField(event.target.value)} disabled={!fields.length}>{!fields.length && <option value="">No fields configured</option>}{fields.map((item) => <option key={item.id} value={item.id}>{item.name}{item.crop ? ` · ${item.crop}` : ''}</option>)}</select></label>
          <label><span>SCREENING THRESHOLD</span><div className="field-work-number"><input type="number" min="20" max="55" step="0.5" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /><b>°C</b></div><small>HeatShield planning threshold, not an occupational standard</small></label>
          <label><span>FORTYGUARD RESOLUTION</span><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as 60 | 80 | 100)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></label>
          <button type="button" className="field-work-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={loadingField}><RefreshCw size={15} className={loadingField ? 'spin' : ''} /> Refresh</button>
        </section>

        {error && <div className="field-work-warning"><AlertTriangle size={16} />{error}</div>}

        {!farm || !field ? (
          <section className="field-work-empty panel"><BriefcaseBusiness size={28} /><div><span className="field-work-eyebrow">FIELD SETUP REQUIRED</span><h2>Create a field before planning work</h2><p>Field Work Planner needs an exact saved field polygon so heat evidence and crew positions can be evaluated spatially.</p></div><Link to="/agriculture/fields" className="button button--primary">Open Fields</Link></section>
        ) : (
          <>
            <section className="field-work-kpis">
              <article className="panel"><span><ThermometerSun size={16} /> Verified field peak</span><strong>{formatTemp(profile?.maxTemperatureC)}</strong><small>{profile?.date || 'No verified date'}</small></article>
              <article className="panel"><span><Clock3 size={16} /> Peak heat time</span><strong>{profile?.peakHourLocal || '—'}</strong><small>FortyGuard field layer</small></article>
              <article className="panel"><span><Gauge size={16} /> Above threshold</span><strong>{formatHours(profile?.maxHoursAboveThreshold)}</strong><small>Max verified field cell</small></article>
              <article className="panel"><span><Users size={16} /> Crew in field</span><strong>{workersInsideField.length}</strong><small>{heavyWorkers} heavy-work · {directSunWorkers} direct-sun</small></article>
            </section>

            <section className="field-work-agent panel">
              <div className="field-work-agent__icon"><ShieldCheck size={22} /></div>
              <div><span className="field-work-eyebrow">FIELD WORK AGENT</span><h2>{evidenceReady ? 'Evidence-backed work-window ranking' : 'Waiting for verified field evidence'}</h2><p>{plannerBrief}</p></div>
              <div className="field-work-agent__chips"><span className={evidenceReady ? 'is-ok' : ''}>{evidenceReady ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} Field heat</span><span className={intel?.forecast?.length ? 'is-ok' : ''}><SunMedium size={13} /> Atmospheric forecast</span><span className={workers.length ? 'is-ok' : ''}><Users size={13} /> Farm workforce</span></div>
            </section>

            <section className="field-work-main-grid">
              <div className="field-work-window-card panel">
                <div className="field-work-card-head"><div><span className="field-work-eyebrow">NEXT FORECAST HORIZON</span><h2>Relative Work-Window Ranking</h2><small>Atmospheric temperatures are ranked relative to one another; they are not field-surface temperatures or safety limits.</small></div><span className="field-work-chip"><SunMedium size={14} /> {intel?.conditionSourceLabel || 'Atmospheric source unavailable'}</span></div>
                {forecastWindows.length ? <div className="field-work-window-grid">{forecastWindows.map((window) => <article key={window.time} className={`field-work-window field-work-window--${window.tone}`}><span>{formatTime(window.time)}</span><strong>{formatTemp(window.temperatureC)}</strong><small>{window.label}</small></article>)}</div> : <div className="field-work-no-data"><AlertTriangle size={20} />No atmospheric forecast is available for relative work-window ranking.</div>}
                <div className="field-work-window-note"><ShieldCheck size={15} /><span><strong>How to read this:</strong> cooler candidate blocks are simply the cooler forecast hours in the loaded horizon. Final field-work approval must still account for workload, worker acclimatization, breaks, hydration and applicable regulations.</span></div>
              </div>

              <div className="field-work-readiness panel">
                <div className="field-work-card-head"><div><span className="field-work-eyebrow">PLANNING READINESS</span><h2>Decision Inputs</h2></div></div>
                <div className="field-work-readiness-list">
                  <div><span><ShieldCheck size={16} /> Field heat evidence</span><b className={evidenceReady ? 'is-ready' : ''}>{evidenceReady ? 'Ready' : 'Missing'}</b></div>
                  <div><span><SunMedium size={16} /> Atmospheric horizon</span><b className={forecastWindows.length ? 'is-ready' : ''}>{forecastWindows.length ? `${forecastWindows.length} points` : 'Missing'}</b></div>
                  <div><span><Users size={16} /> Farm workforce</span><b className={workers.length ? 'is-ready' : ''}>{workers.length ? `${workers.length} workers` : 'None'}</b></div>
                  <div><span><MapPin size={16} /> Field-matched crew</span><b className={workersInsideField.length ? 'is-ready' : ''}>{workersInsideField.length ? `${workersInsideField.length} inside` : 'None mapped'}</b></div>
                </div>
                <div className="field-work-guardrail"><AlertTriangle size={17} /><p>HeatShield does not convert a surface-temperature threshold into a worker exposure limit. Use your organization’s heat-safety program and applicable occupational standards for work/rest decisions.</p></div>
              </div>
            </section>

            <section className="field-work-second-grid">
              <FieldWorkMap farm={farm} field={field} tcm={tcm} workers={workersInsideField} />
              <div className="field-work-plan panel">
                <div className="field-work-card-head"><div><span className="field-work-eyebrow">OPERATING SEQUENCE</span><h2>Recommended Planning Flow</h2><small>Evidence → crew → timing → supervisor decision</small></div></div>
                <div className="field-work-plan-list">
                  <article><i>1</i><div><span>BEST RELATIVE ATMOSPHERIC WINDOW</span><strong>{bestWindow ? `${formatTime(bestWindow.time)} · ${formatTemp(bestWindow.temperatureC)}` : 'Unavailable'}</strong><p>Use this as a candidate start/restart time, then verify field conditions and worker controls before release.</p></div></article>
                  <article><i>2</i><div><span>FIELD HEAT PEAK REVIEW</span><strong>{profile?.peakHourLocal || 'Peak time unavailable'}</strong><p>{profile?.maxHoursAboveThreshold != null ? `Some cells show up to ${profile.maxHoursAboveThreshold.toFixed(1)} h above ${profile.thresholdC.toFixed(1)}°C.` : 'Exceedance duration is unavailable.'} Review higher-load tasks around the strongest field-heat period.</p></div></article>
                  <article><i>3</i><div><span>WARMEST ATMOSPHERIC PERIOD</span><strong>{warmestWindow ? `${formatTime(warmestWindow.time)} · ${formatTemp(warmestWindow.temperatureC)}` : 'Unavailable'}</strong><p>This is the warmest relative forecast point in the loaded horizon, not an automatic stop-work trigger.</p></div></article>
                  <article><i>4</i><div><span>CREW CONFIRMATION</span><strong>{workersInsideField.length ? `${workersInsideField.length} worker${workersInsideField.length === 1 ? '' : 's'} spatially matched` : 'No field-matched crew'}</strong><p>Confirm actual task, workload, sun exposure, break plan, hydration and supervisor approval before work begins.</p></div></article>
                </div>
              </div>
            </section>

            <section className="field-work-crew panel">
              <div className="field-work-card-head"><div><span className="field-work-eyebrow">CREW CONTEXT</span><h2>Workers Currently Mapped Inside {field.name}</h2><small>Spatial match uses saved worker coordinates and the exact field polygon.</small></div><Link to="/workers/new" className="button button--outline-teal">Manage Workers</Link></div>
              {workersInsideField.length ? <div className="field-work-crew-grid">{workersInsideField.map((worker) => <article key={worker.id}><div className="field-work-avatar">{worker.initials}</div><div><strong>{worker.name}</strong><span>{worker.task || worker.role}</span><small>{worker.workIntensity || 'workload not set'} · {worker.sunExposure || 'sun exposure not set'} · {worker.location}</small></div><b>{worker.status}</b></article>)}</div> : <div className="field-work-no-data"><Users size={20} />No saved worker coordinates currently fall inside this field. Farm workers are not automatically assumed to be assigned here.</div>}
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
