import { Activity, Building2, ChevronRight, ClipboardList, History, MapPin, Plus, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { OperationalZoneManager } from '../components/site/OperationalZoneManager'
import { SiteMap } from '../components/site/SiteMap'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { Site, SiteIntelligence, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'

function sourceLabel(data: SiteIntelligence | null) {
  if (!data?.conditions) return 'Waiting for verified conditions'
  if (data.conditionSource === 'fortyguard') return data.thermalStatus === 'verified' ? 'FortyGuard current thermal' : 'FortyGuard verified context'
  if (data.conditionSource === 'nws') return 'NWS atmospheric context'
  return 'Verified environmental context'
}

function riskLabel(data: SiteIntelligence | null) {
  if (!data?.risk) return 'Pending'
  return data.risk.level.charAt(0).toUpperCase() + data.risk.level.slice(1)
}

export function SitesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [workersBySite, setWorkersBySite] = useState<Record<string, Worker[]>>({})
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [intelligence, setIntelligence] = useState<SiteIntelligence | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loadingSelected, setLoadingSelected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoadingSites(true)
    api.listSites(controller.signal)
      .then(async (loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && loaded.some((site) => site.id === id)) ?? loaded[0]?.id ?? null
        setSelectedSiteId(preferred)
        const entries = await Promise.all(loaded.map(async (site) => {
          try { return [site.id, await api.listWorkers(site.id, controller.signal)] as const }
          catch { return [site.id, []] as const }
        }))
        if (!controller.signal.aborted) setWorkersBySite(Object.fromEntries(entries))
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
    // initial route preference only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSiteId) { setIntelligence(null); return }
    localStorage.setItem(STORAGE_KEY, selectedSiteId)
    setSearchParams({ site: selectedSiteId }, { replace: true })
    const controller = new AbortController()
    setLoadingSelected(true)
    setIntelligence(null)
    api.getSiteIntelligence(selectedSiteId, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setIntelligence(data) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load selected site.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSelected(false) })
    return () => controller.abort()
  }, [selectedSiteId, setSearchParams])

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null
  const selectedWorkers = selectedSiteId ? workersBySite[selectedSiteId] ?? [] : []
  const totalWorkers = useMemo(() => Object.values(workersBySite).reduce((sum, list) => sum + list.filter((worker) => worker.status === 'active').length, 0), [workersBySite])

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setError(null)
  }

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current])
    setWorkersBySite((current) => ({ ...current, [site.id]: [] }))
    setSelectedSiteId(site.id)
  }

  const siteUpdated = (site: Site) => {
    setSites((current) => current.map((item) => item.id === site.id ? site : item))
    setIntelligence((current) => current && current.site.id === site.id ? { ...current, site } : current)
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        observedAt={intelligence?.observedAt}
        onSiteChange={selectSite}
        onCreateSite={() => setCreateOpen(true)}
        pageTitle="Sites"
        pageSubtitle="Manage work areas, approved operational zones, staffing and verified environmental status without losing site context."
      />

      <div className="sites-page">
        {loadingSites ? <StatePanel kind="loading" title="Loading sites" detail="Reading saved work areas and worker assignments…" /> : (
          <>
            <section className="sites-summary-grid">
              <article className="sites-summary-card panel"><span><Building2 size={17} /> Total Sites</span><strong>{sites.length}</strong><small>{sites.filter((site) => site.status === 'active').length} active work areas</small></article>
              <article className="sites-summary-card panel"><span><UsersRound size={17} /> Active Workers</span><strong>{totalWorkers}</strong><small>Currently working across saved sites</small></article>
              <article className="sites-summary-card panel"><span><Activity size={17} /> Selected Site Risk</span><strong className={`sites-risk-value sites-risk-value--${intelligence?.risk?.level ?? 'pending'}`}>{riskLabel(intelligence)}</strong><small>{selectedSite?.name ?? 'No site selected'}</small></article>
              <article className="sites-summary-card panel"><span><ShieldCheck size={17} /> Approved Zones</span><strong>{selectedSite?.zones.filter((zone) => zone.operationalApproved).length ?? 0}</strong><small>Eligible for Better Place review</small></article>
            </section>

            {!sites.length ? (
              <section className="sites-empty panel"><MapPin size={30} /><div><h2>No work sites yet</h2><p>Create a site by drawing its real work boundary on Google Maps. Workers, verified conditions and plans stay attached to that site.</p></div><button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Create Site</button></section>
            ) : (
              <div className="sites-layout">
                <section className="sites-directory panel">
                  <div className="sites-section-heading"><div><span className="sites-eyebrow">SITE PORTFOLIO</span><h2>Work Sites</h2></div><button className="button button--secondary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Add Site</button></div>
                  <div className="sites-list">{sites.map((site) => {
                    const workers = workersBySite[site.id] ?? []
                    const active = workers.filter((worker) => worker.status === 'active').length
                    const onBreak = workers.filter((worker) => worker.status === 'break').length
                    const selected = site.id === selectedSiteId
                    return <button key={site.id} type="button" className={`sites-list-item${selected ? ' sites-list-item--active' : ''}`} onClick={() => selectSite(site.id)}>
                      <span className="sites-list-icon"><Building2 size={18} /></span>
                      <span className="sites-list-copy"><strong>{site.name}</strong><small>{site.address}</small><span>{active} active worker{active === 1 ? '' : 's'}{onBreak ? ` · ${onBreak} on break` : ''} · {site.zones.filter((zone) => zone.operationalApproved).length} approved zone{site.zones.filter((zone) => zone.operationalApproved).length === 1 ? '' : 's'}</span></span>
                      <span className={`status-pill status-pill--${site.status === 'active' ? 'active' : 'offsite'}`}>{site.status}</span>
                      <ChevronRight size={17} />
                    </button>
                  })}</div>
                </section>

                <section className="sites-detail-column">
                  {loadingSelected && !intelligence ? <StatePanel kind="loading" title="Loading selected site" detail="Requesting the current site snapshot…" /> : selectedSite && intelligence ? <>
                    <section className="sites-map panel"><SiteMap site={selectedSite} workers={intelligence.workers} temperatureC={intelligence.conditions?.temperatureC} weatherLabel={intelligence.conditions?.weatherLabel} /></section>
                    <section className="sites-profile panel">
                      <div className="sites-section-heading"><div><span className="sites-eyebrow">SELECTED SITE</span><h2>{selectedSite.name}</h2><p>{selectedSite.address}</p></div><span className={`sites-risk-badge sites-risk-badge--${intelligence.risk?.level ?? 'pending'}`}>{riskLabel(intelligence)} risk</span></div>
                      <div className="sites-profile-grid">
                        <div><span>Workers assigned</span><strong>{selectedWorkers.length}</strong><small>{selectedWorkers.filter((worker) => worker.status === 'active').length} active{selectedWorkers.some((worker) => worker.status === 'break') ? ` · ${selectedWorkers.filter((worker) => worker.status === 'break').length} on break` : ''}</small></div>
                        <div><span>Temperature</span><strong>{intelligence.conditions ? `${intelligence.conditions.temperatureC.toFixed(1)}°C` : '—'}</strong><small>{sourceLabel(intelligence)}</small></div>
                        <div><span>Heat index</span><strong>{intelligence.conditions ? `${intelligence.conditions.heatIndexC.toFixed(1)}°C` : '—'}</strong><small>{intelligence.conditions ? `${intelligence.conditions.humidityPercent.toFixed(0)}% humidity` : 'Awaiting verified data'}</small></div>
                        <div><span>Approved zones</span><strong>{selectedSite.zones.filter((zone) => zone.operationalApproved).length}</strong><small>Supervisor-defined movement options</small></div>
                      </div>
                      <div className="sites-actions">
                        <button className="button button--secondary" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(selectedSite.id)}`)}><UserPlus size={16} /> Add Worker</button>
                        <button className="button button--primary" onClick={() => navigate(`/plan?site=${encodeURIComponent(selectedSite.id)}`)}><ClipboardList size={16} /> Plan Today</button>
                        <button className="button button--outline-teal" onClick={() => navigate(`/workforce?site=${encodeURIComponent(selectedSite.id)}`)}><ShieldCheck size={16} /> Live Intelligence</button>
                        <button className="button button--history" onClick={() => navigate(`/historical-intelligence?site=${encodeURIComponent(selectedSite.id)}`)}><History size={16} /> Historical Intelligence</button>
                      </div>
                    </section>
                    <OperationalZoneManager site={selectedSite} workers={selectedWorkers} onSiteUpdated={siteUpdated} />
                  </> : null}
                </section>
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
          </>
        )}
      </div>

      <CreateSiteModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
