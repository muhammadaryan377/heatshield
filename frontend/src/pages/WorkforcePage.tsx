import { Filter, LoaderCircle, MapPin, Search, ShieldCheck, Sparkles, UserPlus, UsersRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api } from '../lib/api'
import type { Site, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'

type ExposureFilter = 'all' | 'low' | 'medium' | 'high' | 'extreme'

function workerContextScore(worker: Worker) {
  return [worker.task, worker.workIntensity, worker.sunExposure, worker.shadeAccess, worker.waterAccess != null ? 'water' : null, worker.coordinate].filter(Boolean).length
}

export function WorkforcePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? localStorage.getItem(STORAGE_KEY) ?? '')
  const [workers, setWorkers] = useState<Worker[]>([])
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [exposure, setExposure] = useState<ExposureFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        setSiteId((current) => loaded.some((site) => site.id === current) ? current : loaded[0]?.id ?? '')
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!siteId) {
      setWorkers([])
      return
    }
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    const controller = new AbortController()
    setError(null)
    api.listWorkers(siteId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setWorkers(loaded)
        setSelectedWorkerId((current) => loaded.some((worker) => worker.id === current) ? current : null)
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load workers.') })
    return () => controller.abort()
  }, [setSearchParams, siteId])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const activeWorkers = workers.filter((worker) => worker.status === 'active')
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId) ?? null

  const visibleWorkers = useMemo(() => workers.filter((worker) => {
    const haystack = `${worker.name} ${worker.role} ${worker.team ?? ''} ${worker.task ?? ''} ${worker.location}`.toLowerCase()
    return (!query.trim() || haystack.includes(query.toLowerCase())) && (exposure === 'all' || worker.risk === exposure)
  }), [exposure, query, workers])

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        onSiteChange={setSiteId}
        pageTitle="Workforce"
        pageSubtitle="Who is working, where they are, and whether their operational context is complete enough for heat-aware decisions."
        showAddSite={false}
        showObservation={false}
        showPlanButton={false}
      />

      <main className="wf-final-page wf-workforce-page">
        {loading ? (
          <section className="wf-state panel"><LoaderCircle className="wf-spin" size={24} /><div><strong>Loading workforce</strong><p>Reading worker assignments and operational context.</p></div></section>
        ) : !sites.length ? (
          <section className="wf-state panel"><MapPin size={25} /><div><strong>Create a site first</strong><p>Workers must belong to a real work site.</p></div></section>
        ) : (
          <>
            <section className="wf-workforce-head panel">
              <div><span className="wf-eyebrow"><UsersRound size={14} /> {selectedSite?.name ?? 'Selected site'}</span><h2>{activeWorkers.length} active worker{activeWorkers.length === 1 ? '' : 's'}</h2><p>This screen manages people and assignment context. Heat maps and planning stay in their own workspaces.</p></div>
              <button className="button button--primary" type="button" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(siteId)}`)}><UserPlus size={16} /> Add Worker</button>
            </section>

            <section className="wf-workforce-tools panel">
              <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, task, crew or zone" /></label>
              <div className="wf-filter"><Filter size={15} /><span>Exposure</span><select value={exposure} onChange={(event) => setExposure(event.target.value as ExposureFilter)}><option value="all">All</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="extreme">Extreme</option></select></div>
              <span className="wf-workforce-tools__count">{visibleWorkers.length} shown</span>
            </section>

            <div className={`wf-workforce-layout${selectedWorker ? ' wf-workforce-layout--detail' : ''}`}>
              <section className="wf-worker-table panel">
                <div className="wf-worker-table__head"><span>Worker</span><span>Assignment</span><span>Location</span><span>Exposure</span><span>Context</span></div>
                {!visibleWorkers.length ? <div className="wf-compact-empty"><UsersRound size={20} /><div><strong>No matching workers</strong><p>Add a worker or change the current filters.</p></div></div> : visibleWorkers.map((worker) => {
                  const score = workerContextScore(worker)
                  return <button type="button" className={`wf-worker-row${selectedWorkerId === worker.id ? ' active' : ''}`} key={worker.id} onClick={() => setSelectedWorkerId(worker.id)}>
                    <span className="wf-worker-row__identity"><b>{worker.initials}</b><span><strong>{worker.name}</strong><small>{worker.role}{worker.team ? ` · ${worker.team}` : ''}</small></span></span>
                    <span><strong>{worker.task || 'Task not set'}</strong><small>{worker.workIntensity ? `${worker.workIntensity} intensity` : 'Intensity missing'}</small></span>
                    <span><strong>{worker.location}</strong><small>{worker.coordinate ? `${worker.coordinate.lat.toFixed(4)}, ${worker.coordinate.lng.toFixed(4)}` : 'Not placed'}</small></span>
                    <span><strong className={`wf-risk-text wf-risk-text--${worker.risk}`}>{worker.risk}</strong><small>{worker.status}</small></span>
                    <span><strong>{score}/6</strong><small>{score >= 5 ? 'Planning ready' : 'Needs context'}</small></span>
                  </button>
                })}
              </section>

              {selectedWorker && (
                <aside className="wf-worker-detail panel">
                  <button className="wf-worker-detail__close" type="button" onClick={() => setSelectedWorkerId(null)} aria-label="Close worker details"><X size={17} /></button>
                  <div className="wf-worker-detail__identity"><div className="wf-worker-avatar">{selectedWorker.initials}</div><div><h2>{selectedWorker.name}</h2><p>{selectedWorker.role}{selectedWorker.team ? ` · ${selectedWorker.team}` : ''}</p></div></div>

                  <div className="wf-worker-detail__section"><span>ASSIGNMENT</span><strong>{selectedWorker.task || 'Task not configured'}</strong><p>{selectedWorker.location} · {selectedWorker.workIntensity ?? 'intensity not set'}</p></div>

                  <div className="wf-worker-context-grid">
                    <article><span>Sun</span><strong>{selectedWorker.sunExposure ?? '—'}</strong></article>
                    <article><span>Shade</span><strong>{selectedWorker.shadeAccess ?? '—'}</strong></article>
                    <article><span>Water</span><strong>{selectedWorker.waterAccess == null ? '—' : selectedWorker.waterAccess ? 'Available' : 'No'}</strong></article>
                    <article><span>Shift</span><strong>{selectedWorker.shiftStart && selectedWorker.shiftEnd ? `${selectedWorker.shiftStart}–${selectedWorker.shiftEnd}` : '—'}</strong></article>
                  </div>

                  <div className="wf-worker-detail__section"><span>HEATSHIELD USE</span><p>Operations will join this exact worker coordinate and task context to shared FortyGuard thermal scans. Missing fields remain missing; they are never inferred by the AI.</p></div>

                  <button className="button button--primary" type="button" onClick={() => navigate(`/workforce/operations?site=${encodeURIComponent(siteId)}`)}><Sparkles size={15} /> Evaluate in Operations</button>
                  <button className="button button--quiet" type="button" onClick={() => navigate(`/workforce/site-heat-intelligence?site=${encodeURIComponent(siteId)}`)}><ShieldCheck size={15} /> View site heat behavior</button>
                </aside>
              )}
            </div>
          </>
        )}
        {error && <div className="form-error wf-final-error">{error}</div>}
      </main>
    </AppShell>
  )
}
