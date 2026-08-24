import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Droplets,
  Gauge,
  Layers3,
  Leaf,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sprout,
  SunMedium,
  ThermometerSun,
  Tractor,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type { Coordinate, FortyGuardDailyProfile, RiskLevel, Site, SiteIntelligence, ThermalMapResponse } from '../types/site'
import '../agriculture-overview.css'

const STORAGE_KEY = 'heatshield:selected-agriculture-farm'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const AGRICULTURE_THRESHOLD_C = 35

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function temp(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}°C`
}

function riskName(risk?: RiskLevel | null) {
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
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function forecastLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('en-US', { hour: 'numeric' })
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#53ad67'
  if (ratio < 0.52) return '#d4bf38'
  if (ratio < 0.7) return '#f0a02c'
  if (ratio < 0.86) return '#ec6833'
  return '#cf3945'
}

function polygonCenter(polygon: Coordinate[]) {
  const points = polygon.length > 1 && polygon[0].lat === polygon[polygon.length - 1].lat && polygon[0].lng === polygon[polygon.length - 1].lng
    ? polygon.slice(0, -1)
    : polygon
  if (!points.length) return null
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function FarmThermalMap({ site, thermal, loading, onRefresh }: { site: Site; thermal: ThermalMapResponse | null; loading: boolean; onRefresh: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<google.maps.Polygon[]>([])
  const markersRef = useRef<google.maps.Marker[]>([])
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
          center: site.center,
          zoom: 17,
          mapTypeId: 'satellite',
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#dbe6de',
        })
        mapRef.current = map
        boundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: site.polygon,
          strokeColor: '#f8ffff',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0d8f84',
          fillOpacity: 0.025,
          clickable: false,
          zIndex: 20,
        })
        if (site.polygon.length >= 3) {
          const bounds = new googleInstance.maps.LatLngBounds()
          site.polygon.forEach((point) => bounds.extend(point))
          if (!bounds.isEmpty()) map.fitBounds(bounds, 34)
        }
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      overlaysRef.current.forEach((polygon) => polygon.setMap(null))
      markersRef.current.forEach((marker) => marker.setMap(null))
      overlaysRef.current = []
      markersRef.current = []
      boundaryRef.current?.setMap(null)
      boundaryRef.current = null
      mapRef.current = null
    }
  }, [site.center.lat, site.center.lng, site.id, site.polygon])

  useEffect(() => {
    overlaysRef.current.forEach((polygon) => polygon.setMap(null))
    markersRef.current.forEach((marker) => marker.setMap(null))
    overlaysRef.current = []
    markersRef.current = []

    const map = mapRef.current
    if (!map || thermal?.dataStatus !== 'verified' || !window.google?.maps) return
    const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
    const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))

    overlaysRef.current = thermal.tiles.map((tile) => {
      const color = heatColor(tile.temperatureC, min, max)
      return new google.maps.Polygon({
        map,
        paths: tile.polygon,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: tile.id === thermal.hottestTileId ? 2.3 : 0.7,
        fillColor: color,
        fillOpacity: 0.56,
        zIndex: 10,
      })
    })

    markersRef.current = hottestTiles.map((tile, index) => {
      const center = polygonCenter(tile.polygon)
      if (!center) return null
      return new google.maps.Marker({
        map,
        position: center,
        zIndex: 40 + index,
        title: `Hot zone ${index + 1}`,
        label: { text: `${index + 1}`, color: '#fff', fontWeight: '800', fontSize: '11px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: index === 0 ? 16 : 13,
          fillColor: index === 0 ? '#c93041' : '#e35b37',
          fillOpacity: 0.96,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
        },
      })
    }).filter((marker): marker is google.maps.Marker => Boolean(marker))
  }, [hottestTiles, mapVersion, thermal])

  const verified = thermal?.dataStatus === 'verified'

  return (
    <section className="agri-map-card panel">
      <div className="agri-card-head">
        <div>
          <span className="agri-eyebrow">FARM THERMAL MAP</span>
          <h2>{site.name}</h2>
          <small>{verified ? `FortyGuard surface cells • ${observedLabel(thermal.observedAt)}` : 'Waiting for verified spatial evidence'}</small>
        </div>
        <button type="button" className="agri-icon-button" onClick={onRefresh} disabled={loading} title="Refresh evidence"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
      </div>

      <div className="agri-map-canvas">
        {mapsApiKey && !mapError ? <div ref={containerRef} className="agri-google-map" /> : (
          <div className="agri-map-fallback">
            <Layers3 size={28} />
            <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
            <span>FortyGuard evidence can still load; satellite visualization requires Google Maps.</span>
          </div>
        )}

        <div className="agri-map-badge"><ShieldCheck size={14} /> {verified ? `${thermal.tileCount} verified cells` : 'No synthetic thermal cells'}</div>
        <div className="agri-map-legend"><span>{verified ? temp(thermal.minTemperatureC) : 'Cooler'}</span><i /><span>{verified ? temp(thermal.maxTemperatureC) : 'Hotter'}</span></div>
        {loading && <div className="agri-map-state"><RefreshCw size={18} className="spin" /><span>Requesting FortyGuard farm evidence…</span></div>}
        {!loading && !verified && <div className="agri-map-state agri-map-state--warning"><AlertTriangle size={18} /><span>{thermal?.message ?? 'Verified spatial evidence is unavailable for this farm.'}</span></div>}
      </div>
    </section>
  )
}

export function AgricultureOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [farms, setFarms] = useState<Site[]>([])
  const [farmId, setFarmId] = useState<string | null>(null)
  const [intel, setIntel] = useState<SiteIntelligence | null>(null)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [profile, setProfile] = useState<FortyGuardDailyProfile | null>(null)
  const [loadingFarms, setLoadingFarms] = useState(true)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoadingFarms(true)
    api.listSites(controller.signal)
      .then((sites) => {
        if (!active || controller.signal.aborted) return
        setFarms(sites)
        const requested = searchParams.get('farm')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && sites.some((site) => site.id === id))
        setFarmId(preferred ?? sites[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load farms.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingFarms(false)
      })
    return () => { active = false; controller.abort() }
    // Initial farm selection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!farmId) return
    localStorage.setItem(STORAGE_KEY, farmId)
    setSearchParams({ farm: farmId }, { replace: true })

    const controller = new AbortController()
    let active = true
    setLoadingEvidence(true)
    setError(null)

    Promise.allSettled([
      api.getSiteIntelligence(farmId, controller.signal),
      api.generateThermalMap(farmId, { mode: 'site', granularityMeters: 100 }, controller.signal),
      api.generateFortyGuardProfile(farmId, { thresholdC: AGRICULTURE_THRESHOLD_C, granularityMeters: 100 }, controller.signal),
    ]).then(([intelResult, thermalResult, profileResult]) => {
      if (!active || controller.signal.aborted) return
      setIntel(intelResult.status === 'fulfilled' ? intelResult.value : null)
      setThermal(thermalResult.status === 'fulfilled' ? thermalResult.value : null)
      setProfile(profileResult.status === 'fulfilled' ? profileResult.value : null)
      const failures = [intelResult, thermalResult, profileResult].filter((result) => result.status === 'rejected')
      if (failures.length === 3) setError('HeatShield could not load farm intelligence or FortyGuard evidence for this farm.')
    }).finally(() => {
      if (active && !controller.signal.aborted) setLoadingEvidence(false)
    })

    return () => { active = false; controller.abort() }
  }, [farmId, refreshKey, setSearchParams])

  const farm = useMemo(() => farms.find((site) => site.id === farmId) ?? intel?.site ?? null, [farms, farmId, intel?.site])
  const verified = thermal?.dataStatus === 'verified'
  const profileAvailable = profile?.dataStatus === 'verified' || profile?.dataStatus === 'partial'
  const risk = intel?.risk?.level
  const hottestTiles = useMemo(() => verified && thermal ? [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC).slice(0, 5) : [], [thermal, verified])
  const forecast = useMemo(() => (intel?.forecast ?? []).slice(0, 12).map((point) => ({ time: forecastLabel(point.time), temperatureC: point.temperatureC })), [intel?.forecast])
  const hotspotDelta = verified && thermal?.maxTemperatureC != null && thermal.meanTemperatureC != null ? thermal.maxTemperatureC - thermal.meanTemperatureC : null
  const peakWindow = intel?.risk?.peakWindowStart && intel.risk.peakWindowEnd ? `${intel.risk.peakWindowStart} – ${intel.risk.peakWindowEnd}` : profile?.peakHourLocal ? `Peak near ${profile.peakHourLocal}` : 'Not available'
  const irrigationPriority = !verified ? 'Awaiting evidence' : (profile?.maxHoursAboveThreshold ?? 0) >= 3 || (thermal?.maxTemperatureC ?? 0) >= 38 ? 'High inspection priority' : (thermal?.maxTemperatureC ?? 0) >= AGRICULTURE_THRESHOLD_C ? 'Review priority' : 'Routine monitor'
  const fieldWorkWindow = risk === 'high' || risk === 'extreme' ? 'Morning preferred' : risk === 'medium' ? 'Morning / late day' : risk === 'low' ? 'Normal schedule' : 'Awaiting evidence'
  const cropScreen = !verified ? 'Pending' : (thermal?.maxTemperatureC ?? 0) >= 38 ? 'High thermal stress screen' : (thermal?.maxTemperatureC ?? 0) >= AGRICULTURE_THRESHOLD_C ? 'Elevated thermal screen' : 'Routine thermal screen'

  const brief = verified
    ? `Verified FortyGuard cells show a ${temp(thermal?.maxTemperatureC)} farm peak and ${temp(thermal?.meanTemperatureC)} mean${profileAvailable && profile?.maxHoursAboveThreshold != null ? `, with up to ${profile.maxHoursAboveThreshold.toFixed(1)} hours above ${AGRICULTURE_THRESHOLD_C}°C` : ''}. Prioritize scouting and irrigation inspection around the hottest zone, and schedule field work outside the peak exposure window when practical.`
    : 'HeatShield is waiting for verified FortyGuard spatial evidence before issuing a farm-level thermal recommendation.'

  return (
    <AppShell module="agriculture">
      <header className="agri-topbar">
        <div>
          <h1>Agriculture Heat Intelligence</h1>
          <span>FortyGuard-powered thermal evidence for farms, crop screening, irrigation inspection and field work planning.</span>
        </div>
        <div className="agri-topbar__spacer" />
        <div className="agri-core-badge"><span className="agri-core-badge__dot" /><span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="agri-overview">
        {loadingFarms && <StatePanel kind="loading" title="Loading Agriculture Intelligence" detail="Reading farm boundaries and evidence configuration…" />}
        {!loadingFarms && error && !farm && <StatePanel kind="error" title="Farm intelligence unavailable" detail={error} onRetry={() => window.location.reload()} />}
        {!loadingFarms && !farms.length && !error && (
          <section className="agri-empty panel"><Sprout size={28} /><div><span className="agri-eyebrow">START WITH A FARM BOUNDARY</span><h2>No farms are configured yet</h2><p>Add a site boundary first. Agriculture intelligence reuses that verified geometry as the farm AOI and never fabricates a thermal field layer.</p></div><Link to="/sites" className="button button--primary">Add Farm Boundary</Link></section>
        )}

        {farm && (
          <>
            <section className="agri-context panel">
              <label><span>FARM</span><div><MapPin size={16} /><select value={farm.id} onChange={(event) => { setFarmId(event.target.value); setIntel(null); setThermal(null); setProfile(null) }}>{farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><small>{farm.address}</small></label>
              <div><span>EVIDENCE OBSERVATION</span><strong><CalendarDays size={16} /> {observedLabel(thermal?.observedAt ?? intel?.observedAt)}</strong><small>{thermal?.timezoneName ?? 'Farm local time when available'}</small></div>
              <div><span>ANALYSIS MODE</span><strong><Layers3 size={16} /> Current + daily profile</strong><small>{AGRICULTURE_THRESHOLD_C}°C screening threshold</small></div>
              <div><span>VERIFICATION</span><strong className={verified ? 'verified' : 'pending'}>{verified ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}{verified ? 'FortyGuard verified' : loadingEvidence ? 'Checking provider' : 'Evidence incomplete'}</strong><small>{verified ? `${thermal?.tileCount ?? 0} spatial cells` : 'No synthetic provider cells'}</small></div>
              <button type="button" className="agri-refresh" onClick={refresh} disabled={loadingEvidence}><RefreshCw size={15} className={loadingEvidence ? 'spin' : ''} /> Refresh</button>
            </section>

            {error && <div className="agri-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="agri-hero-grid">
              <FarmThermalMap site={farm} thermal={thermal} loading={loadingEvidence} onRefresh={refresh} />

              <aside className="agri-status panel">
                <div className="agri-card-head"><div><span className="agri-eyebrow">FARM STATUS</span><h2>Today&apos;s heat picture</h2></div><span className={`agri-risk-pill agri-risk-pill--${riskTone(risk)}`}>{riskName(risk)}</span></div>
                <div className="agri-status-grid">
                  <article><span><ThermometerSun size={17} /> Peak surface temp</span><strong>{temp(thermal?.maxTemperatureC)}</strong><small>{verified ? 'Verified hottest cell' : 'Awaiting spatial cells'}</small></article>
                  <article><span><Gauge size={17} /> Mean surface temp</span><strong>{temp(thermal?.meanTemperatureC)}</strong><small>{verified ? 'Farm AOI mean' : 'No synthetic mean'}</small></article>
                  <article><span><SunMedium size={17} /> Hottest-zone delta</span><strong>{hotspotDelta == null ? '—' : `+${hotspotDelta.toFixed(1)}°C`}</strong><small>Hottest cell vs farm mean</small></article>
                  <article><span><Clock3 size={17} /> Peak exposure window</span><strong>{peakWindow}</strong><small>Provider / risk timing evidence</small></article>
                  <article><span><Droplets size={17} /> Irrigation attention</span><strong>{irrigationPriority}</strong><small>Inspection priority, not water quantity</small></article>
                  <article><span><Users size={17} /> Field work window</span><strong>{fieldWorkWindow}</strong><small>Use Workforce Safety for crew controls</small></article>
                </div>
              </aside>
            </section>

            <section className="agri-agent panel">
              <div className="agri-agent__icon"><Activity size={20} /></div>
              <div className="agri-agent__copy"><span className="agri-eyebrow">AGRICULTURE AGENT BRIEF</span><p>{brief}</p></div>
              <div className="agri-evidence-chips"><span><ThermometerSun size={13} /> Heatmap</span><span><Gauge size={13} /> Environment</span><span><Clock3 size={13} /> Daily profile</span><span className={verified ? 'verified' : ''}><ShieldCheck size={13} /> {verified ? 'Verified evidence' : 'Evidence pending'}</span></div>
            </section>

            <section className="agri-action-grid">
              <article className="agri-action-card"><div><Leaf size={20} /><span className={`agri-mini-pill agri-mini-pill--${riskTone(risk)}`}>{cropScreen}</span></div><h3>Crop Heat Stress</h3><p>Thermal screening flags where deeper crop- and growth-stage analysis should start.</p><Link to="/agriculture/crop-heat-stress">Review crop screening <ArrowRight size={14} /></Link></article>
              <article className="agri-action-card"><div><Droplets size={20} /><span className="agri-mini-pill agri-mini-pill--warning">{irrigationPriority}</span></div><h3>Irrigation Priority</h3><p>Use hottest zones, threshold duration and weather context to prioritize field inspection.</p><Link to="/agriculture/irrigation">Open irrigation planner <ArrowRight size={14} /></Link></article>
              <article className="agri-action-card"><div><Tractor size={20} /><span className="agri-mini-pill">{fieldWorkWindow}</span></div><h3>Field Work Windows</h3><p>Move heat-sensitive farm work away from the strongest exposure period where practical.</p><Link to="/agriculture/field-work">Plan field work <ArrowRight size={14} /></Link></article>
              <article className="agri-action-card"><div><AlertTriangle size={20} /><span className={`agri-mini-pill agri-mini-pill--${riskTone(risk)}`}>{risk ? `${riskName(risk)} watch` : 'Pending'}</span></div><h3>Alerts</h3><p>Surface meaningful threshold, persistence and operational changes instead of raw weather noise.</p><Link to="/agriculture/alerts">View alert logic <ArrowRight size={14} /></Link></article>
            </section>

            <section className="agri-section-head"><div><span className="agri-eyebrow">WHY THIS MATTERS TODAY</span><h2>Evidence &amp; trends</h2></div></section>
            <section className="agri-analysis-grid">
              <article className="agri-analysis-card"><div className="agri-card-title"><strong>Threshold Exceedance</strong><span>{AGRICULTURE_THRESHOLD_C}°C screening line</span></div><div className="agri-big-metric">{profile?.maxHoursAboveThreshold == null ? '—' : `${profile.maxHoursAboveThreshold.toFixed(1)} h`}</div><p>Maximum time above the configured threshold across verified cells.</p><div className="agri-meter"><i style={{ width: `${Math.min(100, ((profile?.maxHoursAboveThreshold ?? 0) / 8) * 100)}%` }} /></div><small>{profileAvailable ? `${profile?.providerRequestCount ?? 0} provider requests • ${profile?.tcmCellCount ?? 0} TCM cells` : 'Daily profile unavailable'}</small></article>

              <article className="agri-analysis-card"><div className="agri-card-title"><strong>Hottest Zones</strong><span>Verified spatial ranking</span></div><div className="agri-zone-list">{hottestTiles.length ? hottestTiles.map((tile, index) => <div key={tile.id}><span className="agri-rank">{index + 1}</span><span><strong>Farm zone {index + 1}</strong><small>FortyGuard cell</small></span><b>{temp(tile.temperatureC)}</b></div>) : <p>No verified thermal cells are available.</p>}</div></article>

              <article className="agri-analysis-card agri-chart-card"><div className="agri-card-title"><strong>Hourly Heat Outlook</strong><span>Condition forecast context</span></div>{forecast.length ? <ResponsiveContainer width="100%" height={180}><LineChart data={forecast} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}><XAxis dataKey="time" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} unit="°" /><Tooltip formatter={(value) => [`${Number(value).toFixed(1)}°C`, 'Temperature']} /><Line dataKey="temperatureC" type="monotone" stroke="#0f8f86" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer> : <div className="agri-chart-empty"><Activity size={20} /> Forecast context unavailable.</div>}<small>Forecast is condition context; spatial farm cells remain FortyGuard-only.</small></article>

              <article className="agri-analysis-card"><div className="agri-card-title"><strong>Evidence Snapshot</strong><span>Decision provenance</span></div><div className="agri-source-list"><div><ShieldCheck size={16} /><span><strong>Spatial heatmap</strong><small>{verified ? `${thermal?.tileCount ?? 0} verified cells` : 'Unavailable'}</small></span></div><div><Clock3 size={16} /><span><strong>Exceedance / persistence</strong><small>{profileAvailable ? `${profile?.layers.filter((layer) => layer.status === 'verified').length ?? 0} verified daily layers` : 'Unavailable'}</small></span></div><div><Gauge size={16} /><span><strong>Environmental context</strong><small>{intel?.conditions ? `${temp(intel.conditions.heatIndexC)} heat index • ${intel.conditions.humidityPercent.toFixed(0)}% RH` : 'Unavailable'}</small></span></div><div><CheckCircle2 size={16} /><span><strong>Decision status</strong><small>{verified ? 'Evidence-backed screening' : 'Recommendation withheld where evidence is missing'}</small></span></div></div></article>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
