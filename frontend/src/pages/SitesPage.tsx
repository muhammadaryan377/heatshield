import { Building2, ChevronRight, MapPin, Plus, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { OperationalZoneManager } from '../components/site/OperationalZoneManager'
import { SiteMap } from '../components/site/SiteMap'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { Site, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'

export function SitesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [workersBySite, setWorkersBySite] = useState<Record<string, Worker[]>>({})
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
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
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // Initial route preference is resolved once; later site changes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSiteId) return
    localStorage.setItem(STORAGE_KEY, selectedSiteId)
    setSearchParams({ site: selectedSiteId }, { replace: true })
  }, [selectedSiteId, setSearchParams])

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null
  const selectedWorkers = selectedSiteId ? workersBySite[selectedSiteId] ?? [] : []
  const approvedZones = selectedSite?.zones.filter((zone) => zone.operationalApproved) ?? []

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
    setWorkersBySite((current) => ({ ...current, [site.id]: [] }))
    setSelectedSiteId(site.id)
  }

  const siteUpdated = (site: Site) => {
    setSites((current) => current.map((item) => item.id === site.id ? site : item))
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        onSiteChange={setSelectedSiteId}
        onCreateSite={() => setCreateOpen(true)}
        pageTitle="Sites & Zones"
        pageSubtitle="Define exactly where work happens and which supervisor-approved areas HeatShield is allowed to consider as operational alternatives."
        showObservation={false}
        showPlanButton={false}
      />

      <main className="wf-final-page wf-sites-page">
        {loading ? (
          <StatePanel kind="loading" title="Loading sites and worker assignments" detail="Preparing the operational spatial model…" />
        ) : !sites.length ? (
          <section className="wf-command-empty panel"><MapPin size={30} /><div><span className="wf-eyebrow">OPERATIONAL GEOMETRY</span><h2>Create the first site boundary</h2><p>Draw the actual work area first. Workers and approved movement zones stay constrained to this saved geometry.</p></div><button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Create Site</button></section>
        ) : (
          <div className="wf-sites-layout">
            <aside className="wf-site-directory panel">
              <div className="wf-section-head"><div><span className="wf-eyebrow">WORK SITES</span><h2>Site library</h2></div><button className="button button--quiet" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} /> Add</button></div>
              <div className="wf-site-directory__list">{sites.map((site) => {
                const workers = workersBySite[site.id] ?? []
                const active = workers.filter((worker) => worker.status === 'active').length
                const zones = site.zones.filter((zone) => zone.operationalApproved).length
                return <button key={site.id} type="button" className={site.id === selectedSiteId ? 'active' : ''} onClick={() => setSelectedSiteId(site.id)}>
                  <span className="wf-site-directory__icon"><Building2 size={17} /></span>
                  <span><strong>{site.name}</strong><small>{active} active worker{active === 1 ? '' : 's'} · {zones} approved zone{zones === 1 ? '' : 's'}</small></span>
                  <ChevronRight size={16} />
                </button>
              })}</div>
            </aside>

            {selectedSite && (
              <section className="wf-site-workspace">
                <article className="wf-site-map-card panel">
                  <div className="wf-section-head">
                    <div><span className="wf-eyebrow">SELECTED SITE</span><h2>{selectedSite.name}</h2><p>{selectedSite.address}</p></div>
                    <div className="wf-site-facts"><span><strong>{selectedWorkers.filter((worker) => worker.status === 'active').length}</strong> active workers</span><span><strong>{approvedZones.length}</strong> approved zones</span><span><strong>{selectedSite.polygon.length}</strong> boundary points</span></div>
                  </div>
                  <div className="wf-site-map-card__map"><SiteMap site={selectedSite} workers={selectedWorkers} /></div>
                  <div className="wf-site-map-card__actions">
                    <button className="button button--secondary" type="button" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(selectedSite.id)}`)}><UserPlus size={15} /> Add Worker</button>
                    <button className="button button--primary" type="button" onClick={() => navigate(`/workforce/operations?site=${encodeURIComponent(selectedSite.id)}`)}><ShieldCheck size={15} /> Open Operations</button>
                  </div>
                </article>

                <section className="wf-zone-purpose panel">
                  <UsersRound size={19} />
                  <div><strong>Zones are operational constraints, not heat labels</strong><p>HeatShield only recommends a Better Place when the destination is supervisor-approved and explicitly compatible with the worker&apos;s task. Thermal evidence is evaluated later in Operations.</p></div>
                </section>

                <OperationalZoneManager site={selectedSite} workers={selectedWorkers} onSiteUpdated={siteUpdated} />
              </section>
            )}
          </div>
        )}

        {error && <div className="form-error wf-final-error">{error}</div>}
      </main>

      <CreateSiteModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
