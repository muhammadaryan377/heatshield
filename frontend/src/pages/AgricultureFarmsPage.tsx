import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Droplets,
  Filter,
  Gauge,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sprout,
  ThermometerSun,
  Tractor,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type { RiskLevel, Site, SiteIntelligence } from '../types/site'
import '../agriculture-farms.css'

const STORAGE_KEY = 'heatshield:selected-agriculture-farm'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function riskTone(risk?: RiskLevel | null) {
  if (risk === 'extreme' || risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  if (risk === 'low') return 'safe'
  return 'neutral'
}

function riskName(risk?: RiskLevel | null) {
  if (!risk) return 'Pending'
  return risk.charAt(0).toUpperCase() + risk.slice(1)
}

function riskWeight(risk?: RiskLevel | null) {
  if (risk === 'extreme') return 4
  if (risk === 'high') return 3
  if (risk === 'medium') return 2
  if (risk === 'low') return 1
  return 0
}

function temp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function areaAcres(site: Site) {
  const points = site.polygon
  if (points.length < 3) return null
  const averageLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos((averageLat * Math.PI) / 180)
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const x1 = current.lng * lngScale
    const y1 = current.lat * latScale
    const x2 = next.lng * lngScale
    const y2 = next.lat * latScale
    twiceArea += x1 * y2 - x2 * y1
  }
  const squareMeters = Math.abs(twiceArea) / 2
  return squareMeters / 4046.8564224
}

function workWindow(risk?: RiskLevel | null) {
  if (risk === 'extreme' || risk === 'high') return 'Early morning preferred'
  if (risk === 'medium') return 'Morning / late day'
  if (risk === 'low') return 'Normal schedule'
  return 'Awaiting evidence'
}

function sourceLabel(intel?: SiteIntelligence | null) {
  if (!intel) return 'Not loaded'
  if (intel.conditionSourceLabel) return intel.conditionSourceLabel
  if (intel.conditionSource === 'fortyguard') return 'FortyGuard'
  if (intel.conditionSource === 'nws') return 'NWS fallback'
  return 'Unavailable'
}

function riskColor(risk?: RiskLevel | null) {
  if (risk === 'extreme') return '#be2637'
  if (risk === 'high') return '#dc483f'
  if (risk === 'medium') return '#e59c22'
  if (risk === 'low') return '#2f9d67'
  return '#83929a'
}

function PortfolioMap({ farms, intelligence, selectedId, onSelect }: {
  farms: Site[]
  intelligence: Record<string, SiteIntelligence | null>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonsRef = useRef<google.maps.Polygon[]>([])
  const markersRef = useRef<google.maps.Marker[]>([])
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

  useEffect(() => {
    if (!mapsApiKey || !containerRef.current || !farms.length) return
    let cancelled = false
    setMapError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return
        const map = new googleInstance.maps.Map(containerRef.current, {
          center: farms[0].center,
          zoom: 8,
          mapTypeId: 'satellite',
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#dbe4db',
        })
        mapRef.current = map
        const bounds = new googleInstance.maps.LatLngBounds()
        farms.forEach((farm) => {
          if (farm.polygon.length >= 3) farm.polygon.forEach((point) => bounds.extend(point))
          else bounds.extend(farm.center)
        })
        if (!bounds.isEmpty()) map.fitBounds(bounds, 52)
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      polygonsRef.current.forEach((polygon) => polygon.setMap(null))
      markersRef.current.forEach((marker) => marker.setMap(null))
      polygonsRef.current = []
      markersRef.current = []
      mapRef.current = null
    }
  }, [farms])

  useEffect(() => {
    polygonsRef.current.forEach((polygon) => polygon.setMap(null))
    markersRef.current.forEach((marker) => marker.setMap(null))
    polygonsRef.current = []
    markersRef.current = []
    if (!mapRef.current || !window.google?.maps) return

    polygonsRef.current = farms.map((farm) => {
      const selected = farm.id === selectedId
      const color = riskColor(intelligence[farm.id]?.risk?.level)
      const polygon = new google.maps.Polygon({
        map: mapRef.current,
        paths: farm.polygon,
        strokeColor: selected ? '#ffffff' : color,
        strokeOpacity: 1,
        strokeWeight: selected ? 3.4 : 2,
        fillColor: color,
        fillOpacity: selected ? 0.28 : 0.14,
        zIndex: selected ? 20 : 10,
      })
      polygon.addListener('click', () => onSelect(farm.id))
      return polygon
    })

    markersRef.current = farms.map((farm) => {
      const risk = intelligence[farm.id]?.risk?.level
      const marker = new google.maps.Marker({
        map: mapRef.current,
        position: farm.center,
        title: `${farm.name} • ${riskName(risk)}`,
        label: {
          text: farm.name.slice(0, 2).toUpperCase(),
          color: '#ffffff',
          fontSize: '10px',
          fontWeight: '800',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: farm.id === selectedId ? 18 : 15,
          fillColor: riskColor(risk),
          fillOpacity: 0.96,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        zIndex: farm.id === selectedId ? 50 : 30,
      })
      marker.addListener('click', () => onSelect(farm.id))
      return marker
    })
  }, [farms, intelligence, mapVersion, onSelect, selectedId])

  return (
    <section className="agri-farms-map panel">
      <div className="agri-farms-section-head">
        <div><span>PORTFOLIO MAP</span><h2>Farm footprint & heat priority</h2></div>
        <div className="agri-map-risk-legend"><i className="safe" /> Low <i className="warning" /> Medium <i className="danger" /> High</div>
      </div>
      <div className="agri-farms-map__canvas">
        {mapsApiKey && !mapError ? <div ref={containerRef} className="agri-farms-map__google" /> : (
          <div className="agri-farms-map__fallback"><MapPin size={28} /><strong>{mapError ?? 'Google Maps API key is not configured.'}</strong><span>Farm portfolio data remains available without the map.</span></div>
        )}
      </div>
    </section>
  )
}

export function AgricultureFarmsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [farms, setFarms] = useState<Site[]>([])
  const [intelligence, setIntelligence] = useState<Record<string, SiteIntelligence | null>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all')
  const [loading, setLoading] = useState(true)
  const [intelLoading, setIntelLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    api.listSites(controller.signal)
      .then((sites) => {
        if (!active || controller.signal.aborted) return
        setFarms(sites)
        const requested = searchParams.get('farm')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && sites.some((site) => site.id === id))
        setSelectedId(preferred ?? sites[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load farm portfolio.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false)
      })
    return () => { active = false; controller.abort() }
    // Farm inventory is loaded once; refresh below only re-runs evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!farms.length) {
      setIntelligence({})
      setIntelLoading(false)
      return
    }
    const controller = new AbortController()
    let active = true
    setIntelLoading(true)

    Promise.allSettled(farms.map((farm) => api.getSiteIntelligence(farm.id, controller.signal)))
      .then((results) => {
        if (!active || controller.signal.aborted) return
        const next: Record<string, SiteIntelligence | null> = {}
        farms.forEach((farm, index) => {
          const result = results[index]
          next[farm.id] = result?.status === 'fulfilled' ? result.value : null
        })
        setIntelligence(next)
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setIntelLoading(false)
      })

    return () => { active = false; controller.abort() }
  }, [farms, refreshKey])

  const selectFarm = useCallback((id: string) => {
    setSelectedId(id)
    localStorage.setItem(STORAGE_KEY, id)
    setSearchParams({ farm: id }, { replace: true })
  }, [setSearchParams])

  const filteredFarms = useMemo(() => farms.filter((farm) => {
    const haystack = `${farm.name} ${farm.address}`.toLowerCase()
    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase())
    const farmRisk = intelligence[farm.id]?.risk?.level
    const matchesRisk = riskFilter === 'all' || farmRisk === riskFilter
    return matchesSearch && matchesRisk
  }), [farms, intelligence, riskFilter, search])

  const totalAcres = useMemo(() => farms.reduce((sum, farm) => sum + (areaAcres(farm) ?? 0), 0), [farms])
  const highRiskCount = useMemo(() => farms.filter((farm) => ['high', 'extreme'].includes(intelligence[farm.id]?.risk?.level ?? '')).length, [farms, intelligence])
  const irrigationReviewCount = useMemo(() => farms.filter((farm) => {
    const intel = intelligence[farm.id]
    const risk = intel?.risk?.level
    const heatIndex = intel?.conditions?.heatIndexC
    return risk === 'high' || risk === 'extreme' || (heatIndex != null && heatIndex >= 35)
  }).length, [farms, intelligence])
  const verifiedConditionsCount = useMemo(() => farms.filter((farm) => intelligence[farm.id]?.conditionSource === 'fortyguard').length, [farms, intelligence])

  const priorities = useMemo(() => farms
    .map((farm) => ({ farm, intel: intelligence[farm.id] }))
    .filter((item) => item.intel)
    .sort((a, b) => {
      const riskDifference = riskWeight(b.intel?.risk?.level) - riskWeight(a.intel?.risk?.level)
      if (riskDifference) return riskDifference
      return (b.intel?.conditions?.heatIndexC ?? -999) - (a.intel?.conditions?.heatIndexC ?? -999)
    })
    .slice(0, 5), [farms, intelligence])

  const selectedFarm = useMemo(() => farms.find((farm) => farm.id === selectedId) ?? null, [farms, selectedId])
  const selectedIntel = selectedId ? intelligence[selectedId] : null

  const onFarmCreated = (farm: Site) => {
    setFarms((current) => [farm, ...current.filter((item) => item.id !== farm.id)])
    selectFarm(farm.id)
  }

  return (
    <AppShell module="agriculture">
      <header className="agri-farms-topbar">
        <div>
          <h1>Farm Portfolio & Operations</h1>
          <span>Manage farm boundaries, compare heat exposure, and decide which farms need attention first.</span>
        </div>
        <div className="agri-farms-topbar__spacer" />
        <div className="agri-core-badge"><span /><div><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="agri-farms-page">
        {loading && <StatePanel kind="loading" title="Loading farms" detail="Reading saved farm boundaries and portfolio context…" />}
        {!loading && error && !farms.length && <StatePanel kind="error" title="Farm portfolio unavailable" detail={error} onRetry={() => window.location.reload()} />}

        {!loading && !farms.length && !error && (
          <section className="agri-farms-empty panel">
            <span><Sprout size={28} /></span>
            <div><small>START WITH A REAL FARM BOUNDARY</small><h2>Add your first farm</h2><p>HeatShield needs the actual farm polygon before FortyGuard spatial evidence can be requested. No synthetic farm heat map is created.</p></div>
            <button type="button" className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Add Farm</button>
          </section>
        )}

        {!!farms.length && (
          <>
            <section className="agri-farms-toolbar panel">
              <label className="agri-farms-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search farms by name or location" /></label>
              <label className="agri-farms-filter"><Filter size={16} /><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as 'all' | RiskLevel)}><option value="all">All heat risk</option><option value="extreme">Extreme</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <button type="button" className="agri-farms-refresh" onClick={refresh} disabled={intelLoading}><RefreshCw size={15} className={intelLoading ? 'spin' : ''} /> {intelLoading ? 'Refreshing evidence' : 'Refresh intelligence'}</button>
              <button type="button" className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Add Farm</button>
            </section>

            <section className="agri-farms-kpis">
              <article><span><Sprout size={17} /> Total Farms</span><strong>{farms.length}</strong><small>{farms.filter((farm) => farm.status === 'active').length} active boundaries</small></article>
              <article><span><Tractor size={17} /> Total Mapped Area</span><strong>{totalAcres > 0 ? `${Math.round(totalAcres).toLocaleString()} ac` : '—'}</strong><small>Calculated from saved polygons</small></article>
              <article className="danger"><span><ThermometerSun size={17} /> High-Risk Farms</span><strong>{intelLoading ? '…' : highRiskCount}</strong><small>High or extreme current risk</small></article>
              <article className="warning"><span><Droplets size={17} /> Irrigation Review</span><strong>{intelLoading ? '…' : irrigationReviewCount}</strong><small>Heat-based inspection priority</small></article>
              <article><span><ShieldCheck size={17} /> FortyGuard Conditions</span><strong>{intelLoading ? '…' : `${verifiedConditionsCount}/${farms.length}`}</strong><small>Direct provider condition source</small></article>
            </section>

            <section className="agri-farms-table-card panel">
              <div className="agri-farms-section-head">
                <div><span>FARM INVENTORY</span><h2>Operational portfolio</h2></div>
                <small>{filteredFarms.length} of {farms.length} farms shown</small>
              </div>
              <div className="agri-farms-table-wrap">
                <table className="agri-farms-table">
                  <thead><tr><th>Farm</th><th>Mapped area</th><th>Current heat risk</th><th>Heat index</th><th>Peak window</th><th>Work timing</th><th>Evidence</th><th /></tr></thead>
                  <tbody>
                    {filteredFarms.map((farm) => {
                      const intel = intelligence[farm.id]
                      const risk = intel?.risk?.level
                      const acres = areaAcres(farm)
                      const peakWindow = intel?.risk?.peakWindowStart && intel.risk.peakWindowEnd ? `${intel.risk.peakWindowStart} – ${intel.risk.peakWindowEnd}` : 'Not returned'
                      return (
                        <tr key={farm.id} className={farm.id === selectedId ? 'selected' : ''} onClick={() => selectFarm(farm.id)}>
                          <td><div className="agri-farm-name"><span><Sprout size={17} /></span><div><strong>{farm.name}</strong><small>{farm.address}</small></div></div></td>
                          <td><strong>{acres == null ? '—' : `${Math.round(acres).toLocaleString()} ac`}</strong><small>{farm.polygon.length} boundary points</small></td>
                          <td><span className={`agri-risk agri-risk--${riskTone(risk)}`}>{riskName(risk)}</span><small>{intel?.risk?.summary ?? (intelLoading ? 'Loading intelligence…' : 'Evidence unavailable')}</small></td>
                          <td><strong>{temp(intel?.conditions?.heatIndexC)}</strong><small>{intel?.conditions ? `${intel.conditions.humidityPercent.toFixed(0)}% RH` : 'No condition reading'}</small></td>
                          <td><strong>{peakWindow}</strong><small>{intel?.risk ? 'Current decision window' : 'Awaiting evidence'}</small></td>
                          <td><strong>{workWindow(risk)}</strong><small>Heat-based planning context</small></td>
                          <td><strong>{sourceLabel(intel)}</strong><small>{intel?.fallbackActive ? 'Atmospheric fallback active' : intel ? 'Source traceable' : 'Not loaded'}</small></td>
                          <td><Link to={`/agriculture?farm=${farm.id}`} onClick={(event) => event.stopPropagation()}>Open <ArrowRight size={13} /></Link></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="agri-farms-lower-grid">
              <PortfolioMap farms={farms} intelligence={intelligence} selectedId={selectedId} onSelect={selectFarm} />

              <aside className="agri-farms-priorities panel">
                <div className="agri-farms-section-head">
                  <div><span>AGENT PRIORITY QUEUE</span><h2>Portfolio priorities today</h2></div>
                  <span className="agri-confidence"><CheckCircle2 size={14} /> Evidence-ranked</span>
                </div>
                {!priorities.length && <div className="agri-priority-empty"><Activity size={22} /><strong>No ranked intelligence yet</strong><span>Refresh farm evidence to create the portfolio queue.</span></div>}
                {priorities.map(({ farm, intel }, index) => {
                  const risk = intel?.risk?.level
                  const high = risk === 'high' || risk === 'extreme'
                  const heatIndex = intel?.conditions?.heatIndexC
                  return (
                    <article key={farm.id} className="agri-priority-row">
                      <span className={`agri-priority-rank agri-priority-rank--${riskTone(risk)}`}>{index + 1}</span>
                      <div>
                        <strong>{farm.name}</strong>
                        <p>{high ? 'Review field operations and irrigation inspection before peak heat.' : risk === 'medium' ? 'Monitor heat trend and keep field work outside the warmest window where practical.' : 'Routine monitor; no elevated heat action indicated by current evidence.'}</p>
                        <small><Gauge size={13} /> {riskName(risk)} risk {heatIndex != null ? `• Heat index ${temp(heatIndex)}` : ''}</small>
                      </div>
                      <Link to={`/agriculture?farm=${farm.id}`}>Review <ArrowRight size={13} /></Link>
                    </article>
                  )
                })}
              </aside>
            </section>

            {selectedFarm && (
              <section className="agri-selected-farm panel">
                <div className="agri-selected-farm__identity"><span><MapPin size={20} /></span><div><small>SELECTED FARM</small><h2>{selectedFarm.name}</h2><p>{selectedFarm.address}</p></div></div>
                <div><small>Heat risk</small><strong className={`agri-selected-value agri-selected-value--${riskTone(selectedIntel?.risk?.level)}`}>{riskName(selectedIntel?.risk?.level)}</strong></div>
                <div><small>Heat index</small><strong>{temp(selectedIntel?.conditions?.heatIndexC)}</strong></div>
                <div><small>Mapped area</small><strong>{areaAcres(selectedFarm) == null ? '—' : `${Math.round(areaAcres(selectedFarm) as number).toLocaleString()} ac`}</strong></div>
                <div><small>Evidence source</small><strong>{sourceLabel(selectedIntel)}</strong></div>
                <Link className="button button--primary" to={`/agriculture?farm=${selectedFarm.id}`}>Open Farm Intelligence <ArrowRight size={14} /></Link>
              </section>
            )}

            <div className="agri-farms-evidence-note"><AlertTriangle size={15} /><span>Portfolio ranking uses current HeatShield site intelligence and traceable condition evidence. It does not infer crop water quantity or agronomic thresholds that are not configured.</span></div>
          </>
        )}
      </main>

      <CreateSiteModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={onFarmCreated} />
    </AppShell>
  )
}
