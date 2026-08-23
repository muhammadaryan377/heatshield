import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Droplets,
  Edit3,
  Flame,
  History,
  MapPin,
  Plus,
  ShieldCheck,
  SunMedium,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { EditSiteModal } from '../components/site/EditSiteModal'
import { OperationalZoneManager } from '../components/site/OperationalZoneManager'
import { SiteCommandMap } from '../components/site/SiteCommandMap'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { siteManagementApi } from '../lib/siteManagementApi'
import type { Site, SiteIntelligence, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'

function sourceLabel(data: SiteIntelligence | null) {
  if (!data?.conditions) return 'Waiting for verified conditions'
  if (data.conditionSource === 'fortyguard') return 'FortyGuard verified'
  if (data.conditionSource === 'nws') return 'NWS live conditions'
  return 'Verified conditions'
}

function riskLabel(data: SiteIntelligence | null) {
  if (!data?.risk) return 'Pending'
  return data.risk.level.charAt(0).toUpperCase() + data.risk.level.slice(1)
}

function areaAcres(site: Site | null) {
  if (!site || site.polygon.length < 3) return null
  const meanLat = site.polygon.reduce((sum, point) => sum + point.lat, 0) / site.polygon.length
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos(meanLat * Math.PI / 180)
  let twiceArea = 0
  site.polygon.forEach((point, index) => {
    const next = site.polygon[(index + 1) % site.polygon.length]
    twiceArea += point.lng * lngScale * next.lat * latScale - next.lng * lngScale * point.lat * latScale
  })
  return Math.abs(twiceArea) / 2 / 4046.8564224
}

function readiness(site: Site, workers: Worker[], intelligence: SiteIntelligence | null) {
  const approved = site.zones.filter((zone) => zone.operationalApproved)
  const recovery = site.zones.filter((zone) => zone.type === 'recovery' && zone.operationalApproved)
  return [
    { label: 'Site boundary', ready: site.polygon.length >= 3, detail: `${site.polygon.length} saved corners` },
    { label: 'Workers', ready: workers.some((worker) => worker.status !== 'offsite'), detail: `${workers.filter((worker) => worker.status !== 'offsite').length} active` },
    { label: 'Heat evidence', ready: intelligence?.thermalStatus === 'verified' || intelligence?.thermalStatus === 'recent_verified', detail: intelligence?.thermalStatus?.replace('_', ' ') ?? 'not checked' },
    { label: 'Operational zones', ready: approved.length > 0, detail: `${approved.length} approved` },
    { label: 'Recovery area', ready: recovery.length > 0 || site.profile.recoveryAreas > 0, detail: recovery.length ? `${recovery.length} mapped` : `${site.profile.recoveryAreas} profile count` },
  ]
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
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
  const totalWorkers = useMemo(() => Object.values(workersBySite).reduce((sum, list) => sum + list.filter((worker) => worker.status !== 'offsite').length, 0), [workersBySite])
  const selectedArea = areaAcres(selectedSite)
  const readinessItems = selectedSite ? readiness(selectedSite, selectedWorkers, intelligence) : []
  const readinessReady = readinessItems.filter((item) => item.ready).length
  const directSunWorkers = selectedWorkers.filter((worker) => worker.status !== 'offsite' && worker.sunExposure === 'direct').length

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

  const deleteSelectedSite = async () => {
    if (!selectedSite || deleting) return
    const confirmed = window.confirm(`Delete ${selectedSite.name}? This also removes its workers and saved operational approvals. This action cannot be undone.`)
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      await siteManagementApi.deleteSite(selectedSite.id)
      const remaining = sites.filter((site) => site.id !== selectedSite.id)
      setSites(remaining)
      setWorkersBySite((current) => {
        const next = { ...current }
        delete next[selectedSite.id]
        return next
      })
      setSelectedSiteId(remaining[0]?.id ?? null)
      if (!remaining.length) localStorage.removeItem(STORAGE_KEY)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the site.')
    } finally {
      setDeleting(false)
    }
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
        pageSubtitle="Build the operational truth for every worksite: boundaries, workers, heat evidence, zones and site readiness."
      />

      <div className="sites-page sites-command-page">
        {loadingSites ? <StatePanel kind="loading" title="Loading sites" detail="Reading saved work areas and worker assignments…" /> : !sites.length ? (
          <section className="sites-empty panel"><MapPin size={30}/><div><h2>No work sites yet</h2><p>Create a site, draw its real boundary with map dots, then add workers and polygon operational zones.</p></div><button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={17}/> Create Site</button></section>
        ) : <>
          {selectedSite && <section className="site-identity panel">
            <div className="site-identity__main">
              <span className={`site-identity__status site-identity__status--${selectedSite.status}`}>{selectedSite.status}</span>
              <div><span className="sites-eyebrow">SITE OPERATIONS COMMAND CENTER</span><h2>{selectedSite.name}</h2><p>{selectedSite.address}</p></div>
            </div>
            <div className="site-identity__facts">
              <span><UsersRound size={15}/> {selectedWorkers.filter((worker) => worker.status !== 'offsite').length} active workers</span>
              <span><MapPin size={15}/> {selectedArea == null ? 'Area unavailable' : `${selectedArea.toFixed(1)} acres`}</span>
              <span><ShieldCheck size={15}/> {selectedSite.zones.filter((zone) => zone.operationalApproved).length} approved zones</span>
              <span><Activity size={15}/> {sourceLabel(intelligence)}</span>
            </div>
            <div className="site-identity__actions">
              <button type="button" className="button button--secondary" onClick={() => setEditOpen(true)}><Edit3 size={16}/> Edit Site</button>
              <button type="button" className="button button--danger-soft" onClick={() => void deleteSelectedSite()} disabled={deleting}><Trash2 size={16}/> {deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </section>}

          <div className="sites-command-layout">
            <aside className="sites-portfolio panel">
              <div className="sites-section-heading"><div><span className="sites-eyebrow">SITE PORTFOLIO</span><h2>Work Sites <small>{sites.length}</small></h2></div><button className="button button--secondary" onClick={() => setCreateOpen(true)}><Plus size={16}/> Add</button></div>
              <div className="sites-portfolio-list">{sites.map((site) => {
                const workers = workersBySite[site.id] ?? []
                const active = workers.filter((worker) => worker.status !== 'offsite').length
                const selected = site.id === selectedSiteId
                const approved = site.zones.filter((zone) => zone.operationalApproved).length
                return <button key={site.id} type="button" className={`site-portfolio-card${selected ? ' active' : ''}`} onClick={() => selectSite(site.id)}>
                  <span className="site-portfolio-icon"><Building2 size={18}/></span>
                  <span className="site-portfolio-copy"><strong>{site.name}</strong><small>{site.address}</small><span><b>{active}</b> workers · <b>{approved}</b> zones · {site.polygon.length} corners</span></span>
                  <span className={`status-pill status-pill--${site.status === 'active' ? 'active' : 'offsite'}`}>{site.status}</span>
                  <ChevronRight size={16}/>
                </button>
              })}</div>
              <div className="sites-portfolio-total"><UsersRound size={16}/><div><strong>{totalWorkers} active workers</strong><span>across all saved sites</span></div></div>
            </aside>

            <main className="site-command-main">
              {loadingSelected && !intelligence ? <StatePanel kind="loading" title="Loading selected site" detail="Requesting the current site snapshot…" /> : selectedSite ? <>
                <SiteCommandMap site={selectedSite} workers={selectedWorkers} />

                <section className="site-readiness panel">
                  <div className="site-readiness__head"><div><span className="sites-eyebrow">SITE SETUP READINESS</span><h2>{readinessReady}/{readinessItems.length} operational inputs ready</h2></div><span className={readinessReady === readinessItems.length ? 'ready' : 'attention'}>{readinessReady === readinessItems.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>} {readinessReady === readinessItems.length ? 'Ready for planning' : 'Setup needs attention'}</span></div>
                  <div className="site-readiness__grid">{readinessItems.map((item) => <article key={item.label} className={item.ready ? 'ready' : 'missing'}>{item.ready ? <CheckCircle2 size={18}/> : <AlertTriangle size={18}/>}<div><strong>{item.label}</strong><span>{item.detail}</span></div></article>)}</div>
                </section>

                <div className="site-intelligence-grid">
                  <section className="site-profile-command panel">
                    <div className="sites-section-heading"><div><span className="sites-eyebrow">OPERATIONAL PROFILE</span><h2>How this site works</h2></div><button type="button" className="button button--secondary" onClick={() => setEditOpen(true)}><Edit3 size={15}/> Customize</button></div>
                    <div className="site-profile-command__grid">
                      <div><span>Site type</span><strong>{selectedSite.profile.siteType.replace('-', ' ')}</strong></div>
                      <div><span>Surface</span><strong>{selectedSite.profile.surfaceType}</strong></div>
                      <div><span>Operating hours</span><strong>{selectedSite.profile.operatingStart && selectedSite.profile.operatingEnd ? `${selectedSite.profile.operatingStart}–${selectedSite.profile.operatingEnd}` : 'Not set'}</strong></div>
                      <div><span>Shade</span><strong>{selectedSite.profile.shadeAvailability}</strong></div>
                      <div><span>Water stations</span><strong>{selectedSite.profile.waterStations}</strong></div>
                      <div><span>Recovery areas</span><strong>{selectedSite.profile.recoveryAreas}</strong></div>
                      <div><span>Supervisor</span><strong>{selectedSite.profile.supervisor || 'Not set'}</strong></div>
                      <div><span>Emergency point</span><strong>{selectedSite.profile.emergencyPoint || 'Not set'}</strong></div>
                    </div>
                    {selectedSite.profile.typicalTasks.length > 0 && <div className="site-profile-tasks"><span>Typical tasks</span><div>{selectedSite.profile.typicalTasks.map((task) => <b key={task}>{task}</b>)}</div></div>}
                  </section>

                  <aside className="site-intelligence-rail panel">
                    <div><span className="sites-eyebrow">SITE INTELLIGENCE</span><h2>Current operating picture</h2></div>
                    <article><Flame size={18}/><div><span>Current risk</span><strong className={`sites-risk-value--${intelligence?.risk?.level ?? 'pending'}`}>{riskLabel(intelligence)}</strong><small>{intelligence?.risk?.summary ?? 'Waiting for verified conditions'}</small></div></article>
                    <article><SunMedium size={18}/><div><span>Heat index</span><strong>{intelligence?.conditions ? `${intelligence.conditions.heatIndexC.toFixed(1)}°C` : '—'}</strong><small>{sourceLabel(intelligence)}</small></div></article>
                    <article><UsersRound size={18}/><div><span>Worker exposure</span><strong>{directSunWorkers} direct sun</strong><small>{intelligence?.highExposureCount ?? 0} high exposure workers</small></div></article>
                    <article><Droplets size={18}/><div><span>Recovery readiness</span><strong>{selectedSite.zones.filter((zone) => zone.type === 'recovery' && zone.operationalApproved).length} mapped recovery zones</strong><small>{selectedSite.profile.waterStations} water stations in site profile</small></div></article>
                    <div className="site-intelligence-actions">
                      <button className="button button--primary" onClick={() => navigate(`/plan?site=${encodeURIComponent(selectedSite.id)}`)}><ClipboardList size={16}/> Generate Plan</button>
                      <button className="button button--secondary" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(selectedSite.id)}`)}><UserPlus size={16}/> Add Worker</button>
                      <button className="button button--history" onClick={() => navigate(`/heat-history?site=${encodeURIComponent(selectedSite.id)}`)}><History size={16}/> Heat History</button>
                    </div>
                  </aside>
                </div>

                <OperationalZoneManager site={selectedSite} workers={selectedWorkers} onSiteUpdated={siteUpdated} />
              </> : null}
            </main>
          </div>
        </>}
        {error && <div className="form-error sites-command-error">{error}</div>}
      </div>

      <CreateSiteModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={siteCreated}/>
      <EditSiteModal open={editOpen} site={selectedSite} onClose={() => setEditOpen(false)} onUpdated={siteUpdated}/>
    </AppShell>
  )
}
