import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  Filter,
  Flame,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { EnterpriseSitesMap } from '../components/enterprise/EnterpriseSitesMap'
import { AppShell } from '../components/layout/AppShell'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { RiskLevel, Site, SiteIntelligence, ThermalMapResponse } from '../types/site'
import '../enterprise-sites.css'

const STORAGE_KEY = 'heatshield:selected-site'

type EvidenceFilter = 'all' | 'verified' | 'pending' | 'unavailable'
type RiskFilter = 'all' | 'high' | 'medium' | 'low' | 'unscreened'
type StatusFilter = 'all' | 'active' | 'inactive'

interface SiteScreening {
  intelligence: SiteIntelligence | null
  thermal: ThermalMapResponse | null
  loading: boolean
  error: string | null
  completedAt: string | null
}

interface AttentionItem {
  site: Site
  title: string
  detail: string
  tone: 'danger' | 'warning' | 'neutral'
}

const emptyScreening = (): SiteScreening => ({ intelligence: null, thermal: null, loading: false, error: null, completedAt: null })

function formatTemperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function riskName(risk?: RiskLevel | null) {
  return risk ? risk.charAt(0).toUpperCase() + risk.slice(1) : 'Unscreened'
}

function riskTone(risk?: RiskLevel | null) {
  if (risk === 'extreme' || risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  if (risk === 'low') return 'safe'
  return 'neutral'
}

function evidenceState(screening?: SiteScreening): Exclude<EvidenceFilter, 'all'> {
  if (!screening || (!screening.completedAt && !screening.loading)) return 'pending'
  if (screening.loading) return 'pending'
  if (screening.thermal?.dataStatus === 'verified') return 'verified'
  return 'unavailable'
}

function evidenceLabel(screening?: SiteScreening) {
  const state = evidenceState(screening)
  if (screening?.loading) return 'Screening…'
  if (state === 'verified') return 'FortyGuard verified'
  if (state === 'unavailable') return 'Spatial evidence unavailable'
  return 'Not screened'
}

function conditionSource(screening?: SiteScreening) {
  const intel = screening?.intelligence
  if (!intel?.conditions) return 'No atmospheric context'
  if (intel.conditionSource === 'fortyguard') return 'FortyGuard conditions'
  if (intel.conditionSource === 'nws') return 'NWS fallback conditions'
  return intel.conditionSourceLabel ?? 'Condition source available'
}

function geometryReady(site: Site) {
  return site.polygon.length >= 3
}

export function EnterpriseSitesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [screenings, setScreenings] = useState<Record<string, SiteScreening>>({})
  const [sitesLoading, setSitesLoading] = useState(true)
  const [sitesError, setSitesError] = useState<string | null>(null)
  const [createSiteOpen, setCreateSiteOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [portfolioScreening, setPortfolioScreening] = useState(false)
  const [portfolioProgress, setPortfolioProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loadedSites) => {
        if (controller.signal.aborted) return
        setSites(loadedSites)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && loadedSites.some((site) => site.id === id))
        setSelectedSiteId(preferred ?? loadedSites[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSitesError(error instanceof Error ? error.message : 'Unable to load enterprise sites.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setSitesLoading(false)
      })
    return () => controller.abort()
    // initial route preference only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const screenSite = useCallback(async (siteId: string) => {
    setScreenings((current) => ({
      ...current,
      [siteId]: { ...(current[siteId] ?? emptyScreening()), loading: true, error: null },
    }))

    const [intelResult, thermalResult] = await Promise.allSettled([
      api.getSiteIntelligence(siteId),
      api.generateThermalMap(siteId, { mode: 'site', granularityMeters: 100 }),
    ])

    const intelligence = intelResult.status === 'fulfilled' ? intelResult.value : null
    const thermal = thermalResult.status === 'fulfilled' ? thermalResult.value : null
    const errors: string[] = []
    if (intelResult.status === 'rejected') errors.push(intelResult.reason instanceof Error ? intelResult.reason.message : 'Site conditions could not be loaded.')
    if (thermalResult.status === 'rejected') errors.push(thermalResult.reason instanceof Error ? thermalResult.reason.message : 'FortyGuard spatial screening failed.')
    if (thermal && thermal.dataStatus !== 'verified' && thermal.message) errors.push(thermal.message)

    const result: SiteScreening = {
      intelligence,
      thermal,
      loading: false,
      error: errors.length ? errors.join(' ') : null,
      completedAt: new Date().toISOString(),
    }
    setScreenings((current) => ({ ...current, [siteId]: result }))
    return result
  }, [])

  useEffect(() => {
    if (!selectedSiteId) return
    localStorage.setItem(STORAGE_KEY, selectedSiteId)
    setSearchParams({ site: selectedSiteId }, { replace: true })
    const current = screenings[selectedSiteId]
    if (!current?.loading && !current?.completedAt) void screenSite(selectedSiteId)
    // screenings intentionally omitted so an in-flight request is not restarted or cancelled by its own state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenSite, selectedSiteId, setSearchParams])

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites])
  const selectedScreening = selectedSiteId ? screenings[selectedSiteId] ?? emptyScreening() : emptyScreening()

  const filteredSites = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sites.filter((site) => {
      const screening = screenings[site.id]
      const risk = screening?.intelligence?.risk?.level
      const matchesQuery = !needle || `${site.name} ${site.address}`.toLowerCase().includes(needle)
      const matchesStatus = statusFilter === 'all' || site.status === statusFilter
      const matchesEvidence = evidenceFilter === 'all' || evidenceState(screening) === evidenceFilter
      const matchesRisk = riskFilter === 'all'
        || (riskFilter === 'high' && (risk === 'high' || risk === 'extreme'))
        || (riskFilter === 'medium' && risk === 'medium')
        || (riskFilter === 'low' && risk === 'low')
        || (riskFilter === 'unscreened' && !risk)
      return matchesQuery && matchesStatus && matchesEvidence && matchesRisk
    })
  }, [evidenceFilter, query, riskFilter, screenings, sites, statusFilter])

  const geometryReadyCount = sites.filter(geometryReady).length
  const verifiedCount = sites.filter((site) => evidenceState(screenings[site.id]) === 'verified').length
  const screenedCount = sites.filter((site) => Boolean(screenings[site.id]?.completedAt)).length
  const highPriorityCount = sites.filter((site) => {
    const risk = screenings[site.id]?.intelligence?.risk?.level
    return risk === 'high' || risk === 'extreme'
  }).length

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    sites.forEach((site) => {
      const screening = screenings[site.id]
      if (!geometryReady(site)) {
        items.push({ site, title: 'Boundary incomplete', detail: 'Property geometry is not ready for spatial screening.', tone: 'danger' })
        return
      }
      if (!screening?.completedAt) {
        items.push({ site, title: 'Baseline screening pending', detail: 'Run a verified spatial screening for this site.', tone: 'neutral' })
        return
      }
      if (screening.thermal?.dataStatus !== 'verified') {
        items.push({ site, title: 'Spatial evidence unavailable', detail: screening.thermal?.message ?? screening.error ?? 'No verified cells returned.', tone: 'warning' })
        return
      }
      if (screening.intelligence?.fallbackActive) {
        items.push({ site, title: 'Atmospheric fallback active', detail: 'Condition context is fallback; spatial evidence remains FortyGuard-only.', tone: 'warning' })
      }
    })
    return items.slice(0, 5)
  }, [screenings, sites])

  const selectSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId)
    setSitesError(null)
  }, [])

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
    setScreenings((current) => ({ ...current, [site.id]: emptyScreening() }))
    setSelectedSiteId(site.id)
  }

  const runPortfolioScreening = async () => {
    if (!sites.length || portfolioScreening) return
    setPortfolioScreening(true)
    setPortfolioProgress({ done: 0, total: sites.length })
    try {
      for (let index = 0; index < sites.length; index += 1) {
        await screenSite(sites[index].id)
        setPortfolioProgress({ done: index + 1, total: sites.length })
      }
    } finally {
      setPortfolioScreening(false)
    }
  }

  const selectedRisk = selectedScreening.intelligence?.risk?.level
  const hotspotDelta = selectedScreening.thermal?.dataStatus === 'verified'
    && selectedScreening.thermal.maxTemperatureC != null
    && selectedScreening.thermal.meanTemperatureC != null
    ? selectedScreening.thermal.maxTemperatureC - selectedScreening.thermal.meanTemperatureC
    : null

  return (
    <AppShell module="enterprise">
      <header className="enterprise-sites-topbar">
        <div><h1>Enterprise Heat Intelligence</h1><span>Portfolio site registry, geometry readiness and evidence coverage.</span></div>
        <div className="enterprise-sites-topbar__spacer" />
        <div className="enterprise-core-badge"><span className="enterprise-core-badge__dot" /><span><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard evidence core</strong></span></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="enterprise-sites-page">
        <section className="enterprise-sites-title-row">
          <div><span className="enterprise-sites-eyebrow">PROPERTY REGISTRY</span><h2>Sites</h2><p>Manage real property boundaries, verify thermal evidence coverage, and decide which sites need deeper enterprise analysis.</p></div>
          <div className="enterprise-sites-actions">
            <button type="button" className="button button--secondary" onClick={() => setCreateSiteOpen(true)}><Plus size={16} /> Add Site</button>
            <button type="button" className="button button--primary" onClick={() => void runPortfolioScreening()} disabled={portfolioScreening || !sites.length}><RefreshCw size={16} className={portfolioScreening ? 'spin' : ''} />{portfolioScreening ? `Screening ${portfolioProgress.done}/${portfolioProgress.total}` : 'Run Portfolio Screening'}</button>
          </div>
        </section>

        {sitesLoading && <StatePanel kind="loading" title="Loading enterprise sites" detail="Reading saved site geometry and enterprise evidence state…" />}
        {!sitesLoading && sitesError && !sites.length && <StatePanel kind="error" title="Enterprise sites unavailable" detail={sitesError} onRetry={() => window.location.reload()} />}
        {!sitesLoading && !sites.length && !sitesError && (
          <section className="enterprise-sites-empty panel"><span><Building2 size={28} /></span><div><h2>No enterprise sites yet</h2><p>Create a property with its real Google Maps boundary. HeatShield will use that geometry for FortyGuard spatial screening instead of inventing property coverage.</p></div><button type="button" className="button button--primary" onClick={() => setCreateSiteOpen(true)}><Plus size={16} /> Add First Site</button></section>
        )}

        {!sitesLoading && sites.length > 0 && (
          <>
            {sitesError && <div className="enterprise-sites-inline-warning"><AlertTriangle size={15} /> {sitesError}</div>}
            <section className="enterprise-sites-kpis">
              <article><span><Building2 size={17} /> Total Sites</span><strong>{sites.length}</strong><small>{sites.filter((site) => site.status === 'active').length} active properties</small></article>
              <article><span><MapPin size={17} /> Geometry Ready</span><strong>{geometryReadyCount}</strong><small>{sites.length ? Math.round((geometryReadyCount / sites.length) * 100) : 0}% analysis-ready boundaries</small></article>
              <article><span><ShieldCheck size={17} /> Verified Coverage</span><strong>{verifiedCount}</strong><small>{screenedCount} screened in this session</small></article>
              <article className={highPriorityCount ? 'enterprise-sites-kpi--alert' : ''}><span><Flame size={17} /> High-Priority Sites</span><strong>{highPriorityCount}</strong><small>Based only on returned site risk evidence</small></article>
            </section>

            <section className="enterprise-sites-workspace">
              <div className="enterprise-sites-directory panel">
                <div className="enterprise-sites-directory__toolbar">
                  <label className="enterprise-sites-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search site name or address…" /></label>
                  <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
                  <label><span>Evidence</span><select value={evidenceFilter} onChange={(event) => setEvidenceFilter(event.target.value as EvidenceFilter)}><option value="all">All</option><option value="verified">Verified</option><option value="pending">Pending</option><option value="unavailable">Unavailable</option></select></label>
                  <label><span>Risk</span><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}><option value="all">All</option><option value="high">High / Extreme</option><option value="medium">Medium</option><option value="low">Low</option><option value="unscreened">Unscreened</option></select></label>
                  <button type="button" className="enterprise-sites-filter-reset" onClick={() => { setQuery(''); setStatusFilter('all'); setEvidenceFilter('all'); setRiskFilter('all') }}><Filter size={14} /> Clear</button>
                </div>

                <div className="enterprise-sites-table-wrap">
                  <table className="enterprise-sites-table">
                    <thead><tr><th>Site</th><th>Geometry</th><th>Evidence</th><th>Peak Surface</th><th>Risk</th><th /></tr></thead>
                    <tbody>{filteredSites.map((site) => {
                      const screening = screenings[site.id]
                      const risk = screening?.intelligence?.risk?.level
                      const evidence = evidenceState(screening)
                      return <tr key={site.id} className={site.id === selectedSiteId ? 'selected' : ''} onClick={() => selectSite(site.id)}>
                        <td><div className="enterprise-sites-site-cell"><span className="enterprise-sites-site-icon"><Building2 size={16} /></span><span><strong>{site.name}</strong><small>{site.address}</small></span></div></td>
                        <td><span className={`enterprise-sites-state enterprise-sites-state--${geometryReady(site) ? 'verified' : 'unavailable'}`}>{geometryReady(site) ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{geometryReady(site) ? `${site.polygon.length} points` : 'Incomplete'}</span></td>
                        <td><span className={`enterprise-sites-state enterprise-sites-state--${evidence}`}>{screening?.loading ? <RefreshCw className="spin" size={13} /> : evidence === 'verified' ? <ShieldCheck size={13} /> : <Database size={13} />}{evidenceLabel(screening)}</span></td>
                        <td><strong className="enterprise-sites-temp">{formatTemperature(screening?.thermal?.maxTemperatureC)}</strong></td>
                        <td><span className={`enterprise-sites-risk enterprise-sites-risk--${riskTone(risk)}`}>{riskName(risk)}</span></td>
                        <td><button type="button" className="enterprise-sites-row-action" onClick={(event) => { event.stopPropagation(); selectSite(site.id) }}><ArrowRight size={15} /></button></td>
                      </tr>
                    })}</tbody>
                  </table>
                  {!filteredSites.length && <div className="enterprise-sites-no-results">No sites match the current filters.</div>}
                </div>
                <div className="enterprise-sites-directory__footer"><span>{filteredSites.length} of {sites.length} sites shown</span><span>Heat values appear only after a verified screening response.</span></div>
              </div>

              <aside className="enterprise-sites-right-column">
                <div className="panel enterprise-sites-map-card"><EnterpriseSitesMap sites={sites} selectedSiteId={selectedSiteId} thermal={selectedScreening.thermal} onSelectSite={selectSite} /></div>
                {selectedSite && <section className="enterprise-site-profile panel">
                  <div className="enterprise-site-profile__header"><div><span className="enterprise-sites-eyebrow">SELECTED PROPERTY</span><h3>{selectedSite.name}</h3><p><MapPin size={13} /> {selectedSite.address}</p></div><span className={`enterprise-sites-risk enterprise-sites-risk--${riskTone(selectedRisk)}`}>{riskName(selectedRisk)}</span></div>
                  <div className="enterprise-site-profile__metrics">
                    <div><span>Peak surface</span><strong>{formatTemperature(selectedScreening.thermal?.maxTemperatureC)}</strong><small>{selectedScreening.thermal?.dataStatus === 'verified' ? 'FortyGuard spatial max' : 'Not verified'}</small></div>
                    <div><span>Mean surface</span><strong>{formatTemperature(selectedScreening.thermal?.meanTemperatureC)}</strong><small>{selectedScreening.thermal?.tileCount ? `${selectedScreening.thermal.tileCount} cells` : 'No verified cells'}</small></div>
                    <div><span>Hotspot delta</span><strong>{hotspotDelta == null ? '—' : `+${hotspotDelta.toFixed(1)}°C`}</strong><small>Peak minus site mean</small></div>
                    <div><span>Heat index</span><strong>{formatTemperature(selectedScreening.intelligence?.conditions?.heatIndexC)}</strong><small>{conditionSource(selectedScreening)}</small></div>
                  </div>
                  {selectedScreening.error && <div className="enterprise-site-profile__warning"><AlertTriangle size={14} /><span>{selectedScreening.error}</span></div>}
                  {selectedScreening.intelligence?.fallbackActive && <div className="enterprise-site-profile__warning"><AlertTriangle size={14} /><span>Atmospheric context uses a fallback provider. Thermal cells remain FortyGuard-only.</span></div>}
                  <div className="enterprise-site-profile__details"><div><span>Coordinates</span><strong>{selectedSite.center.lat.toFixed(4)}, {selectedSite.center.lng.toFixed(4)}</strong></div><div><span>Boundary</span><strong>{selectedSite.polygon.length} mapped points</strong></div><div><span>Operational zones</span><strong>{selectedSite.zones.length}</strong></div><div><span>Property status</span><strong className={selectedSite.status === 'active' ? 'active' : ''}>{selectedSite.status}</strong></div></div>
                  <div className="enterprise-site-onboarding">
                    <div className="enterprise-site-onboarding__title"><strong>Analysis Readiness</strong><span>{[Boolean(selectedSite.address), geometryReady(selectedSite), selectedScreening.thermal?.dataStatus === 'verified', Boolean(selectedScreening.intelligence?.conditions)].filter(Boolean).length}/4 evidence steps</span></div>
                    <div className="enterprise-site-onboarding__item complete"><CheckCircle2 size={15} /><span><strong>Site location saved</strong><small>Address and center coordinate available</small></span></div>
                    <div className={`enterprise-site-onboarding__item ${geometryReady(selectedSite) ? 'complete' : ''}`}>{geometryReady(selectedSite) ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<span><strong>Property boundary</strong><small>{geometryReady(selectedSite) ? 'Ready for spatial analysis' : 'Boundary requires at least three points'}</small></span></div>
                    <div className={`enterprise-site-onboarding__item ${selectedScreening.thermal?.dataStatus === 'verified' ? 'complete' : ''}`}>{selectedScreening.thermal?.dataStatus === 'verified' ? <CheckCircle2 size={15} /> : <Database size={15} />}<span><strong>FortyGuard spatial baseline</strong><small>{selectedScreening.thermal?.dataStatus === 'verified' ? 'Verified cells available' : 'Run or refresh screening'}</small></span></div>
                    <div className={`enterprise-site-onboarding__item ${selectedScreening.intelligence?.conditions ? 'complete' : ''}`}>{selectedScreening.intelligence?.conditions ? <CheckCircle2 size={15} /> : <Activity size={15} />}<span><strong>Atmospheric context</strong><small>{conditionSource(selectedScreening)}</small></span></div>
                    <div className="enterprise-site-onboarding__item future"><Database size={15} /><span><strong>Asset inventory</strong><small>Connect critical assets in Asset Intelligence; no asset count is fabricated here.</small></span></div>
                  </div>
                  <div className="enterprise-site-profile__actions"><button type="button" className="button button--primary" onClick={() => selectedSiteId && void screenSite(selectedSiteId)} disabled={selectedScreening.loading}><RefreshCw size={15} className={selectedScreening.loading ? 'spin' : ''} /> {selectedScreening.loading ? 'Screening…' : 'Refresh Evidence'}</button><button type="button" className="button button--secondary" onClick={() => navigate(`/enterprise?site=${encodeURIComponent(selectedSite.id)}`)}>Open Overview <ArrowRight size={15} /></button></div>
                </section>}
              </aside>
            </section>

            <section className="enterprise-sites-bottom-grid">
              <article className="enterprise-sites-attention panel"><div className="enterprise-sites-card-heading"><div><span className="enterprise-sites-eyebrow">DATA QUALITY</span><h3>Sites Needing Attention</h3></div><span>{attentionItems.length}</span></div>{attentionItems.length ? attentionItems.map((item) => <button key={`${item.site.id}-${item.title}`} type="button" onClick={() => selectSite(item.site.id)} className={`enterprise-sites-attention__row enterprise-sites-attention__row--${item.tone}`}><span>{item.tone === 'danger' ? <XCircle size={16} /> : item.tone === 'warning' ? <AlertTriangle size={16} /> : <Database size={16} />}</span><span><strong>{item.site.name}</strong><small>{item.title} · {item.detail}</small></span><ArrowRight size={15} /></button>) : <div className="enterprise-sites-all-clear"><ShieldCheck size={20} /><span><strong>No current evidence gaps</strong><small>All saved sites have verified spatial screening and no fallback warning.</small></span></div>}</article>
              <article className="enterprise-sites-coverage panel"><div className="enterprise-sites-card-heading"><div><span className="enterprise-sites-eyebrow">PORTFOLIO READINESS</span><h3>Evidence Coverage</h3></div><span>{sites.length ? Math.round((verifiedCount / sites.length) * 100) : 0}%</span></div><div className="enterprise-sites-coverage__bar"><span style={{ width: `${sites.length ? (verifiedCount / sites.length) * 100 : 0}%` }} /></div><div className="enterprise-sites-coverage__metrics"><div><strong>{verifiedCount}</strong><span>Verified spatial</span></div><div><strong>{Math.max(0, screenedCount - verifiedCount)}</strong><span>Screened without cells</span></div><div><strong>{Math.max(0, sites.length - screenedCount)}</strong><span>Not screened</span></div><div><strong>{highPriorityCount}</strong><span>High priority</span></div></div><p>Coverage is based on actual screening responses from this session. HeatShield does not assign a portfolio heat score to unscreened sites.</p></article>
            </section>
          </>
        )}
      </main>

      <CreateSiteModal open={createSiteOpen} onClose={() => setCreateSiteOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
