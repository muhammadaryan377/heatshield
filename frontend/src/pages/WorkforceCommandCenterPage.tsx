import { AlertTriangle, CheckCircle2, Clock3, Info, LoaderCircle, MapPinned, RefreshCw, ShieldCheck, Sparkles, ThermometerSun, UserPlus, UsersRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { SiteMap } from '../components/site/SiteMapFinal'
import { api } from '../lib/api'
import type { Site, SiteIntelligence, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'

function formatTemperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatTime(value?: string | null) {
  if (!value) return 'No verified observation'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function attentionWorker(worker: Worker) {
  return worker.status === 'active' && (worker.risk === 'high' || worker.risk === 'extreme')
}

export function WorkforceCommandCenterPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string | null>(searchParams.get('site') ?? localStorage.getItem(STORAGE_KEY))
  const [data, setData] = useState<SiteIntelligence | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createSiteOpen, setCreateSiteOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        setSiteId((current) => current && loaded.some((site) => site.id === current) ? current : loaded[0]?.id ?? null)
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!siteId) {
      setData(null)
      return
    }
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api.getSiteIntelligence(siteId, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setData(response) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load site intelligence.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refreshKey, setSearchParams, siteId])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const activeWorkers = data?.workers.filter((worker) => worker.status === 'active') ?? []
  const attentionWorkers = activeWorkers.filter(attentionWorker)
  const upcomingPeak = data?.risk?.peakWindowStart && data?.risk?.peakWindowEnd
    ? `${data.risk.peakWindowStart}–${data.risk.peakWindowEnd}`
    : null

  const forecast = useMemo(() => data?.forecast.slice(0, 6) ?? [], [data?.forecast])

  const briefTitle = !data
    ? 'Waiting for verified site evidence'
    : attentionWorkers.length
      ? `${attentionWorkers.length} worker${attentionWorkers.length === 1 ? '' : 's'} need attention`
      : data.risk?.level === 'high' || data.risk?.level === 'extreme'
        ? 'Site heat requires operational review'
        : 'No immediate operational change supported'

  const briefDetail = attentionWorkers.length
    ? 'Worker context and current site conditions indicate an exposure review is needed. Open Operations to compare time and approved-place alternatives.'
    : data?.nextAction?.detail ?? data?.risk?.detail ?? 'HeatShield will surface only material changes instead of filling the dashboard with repeated metrics.'

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
    setSiteId(site.id)
    setCreateSiteOpen(false)
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId}
        observedAt={data?.thermalObservedAt ?? data?.observedAt}
        onSiteChange={setSiteId}
        onCreateSite={() => setCreateSiteOpen(true)}
        pageTitle="Workforce Command Center"
        pageSubtitle="One operational view: where heat is, who is exposed, what changes next, and which decisions require a supervisor."
        showPlanButton={false}
      />

      <main className="wf-final-page wf-command-center">
        {loadingSites ? (
          <section className="wf-state panel"><LoaderCircle className="wf-spin" size={24} /><div><strong>Loading command center</strong><p>Reading your work sites.</p></div></section>
        ) : !sites.length ? (
          <section className="wf-command-empty panel">
            <MapPinned size={30} />
            <div><span className="wf-eyebrow">START WITH A REAL WORK AREA</span><h2>Create the first site boundary</h2><p>HeatShield needs a real polygon before it can join FortyGuard spatial evidence to workers, zones and operational alternatives.</p></div>
            <button className="button button--primary" type="button" onClick={() => setCreateSiteOpen(true)}>Create Site</button>
          </section>
        ) : loading && !data ? (
          <section className="wf-state panel"><LoaderCircle className="wf-spin" size={24} /><div><strong>Reading current site evidence</strong><p>Joining site, worker and provider context.</p></div></section>
        ) : data && selectedSite ? (
          <>
            <section className="wf-command-grid">
              <div className="wf-command-map">
                <SiteMap site={data.site} workers={data.workers} temperatureC={data.conditions?.temperatureC} weatherLabel={data.conditions?.weatherLabel} />
              </div>

              <aside className="wf-command-brief panel">
                <div className="wf-command-brief__status"><span className={`wf-provider-dot wf-provider-dot--${data.thermalStatus}`} /><strong>{data.thermalStatus === 'verified' ? 'FortyGuard thermal verified' : data.thermalStatus === 'recent_verified' ? 'Recent FortyGuard thermal evidence' : 'Thermal evidence limited'}</strong><button type="button" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'wf-spin' : ''} size={15} /></button></div>
                <span className="wf-eyebrow"><Sparkles size={14} /> HEATSHIELD AGENT BRIEF</span>
                <h2>{briefTitle}</h2>
                <p>{briefDetail}</p>

                <div className="wf-command-brief__facts">
                  <article><ThermometerSun size={17} /><div><span>Site heat</span><strong>{formatTemperature(data.conditions?.temperatureC)}</strong><small>{formatTime(data.thermalObservedAt ?? data.observedAt)}</small></div></article>
                  <article><UsersRound size={17} /><div><span>Active workers</span><strong>{activeWorkers.length}</strong><small>{attentionWorkers.length} require review</small></div></article>
                  <article><Clock3 size={17} /><div><span>Peak window</span><strong>{upcomingPeak ?? 'No peak flagged'}</strong><small>{data.risk?.summary ?? 'Current risk context'}</small></div></article>
                </div>

                <button className="button button--primary wf-command-brief__cta" type="button" onClick={() => navigate(`/workforce/operations?site=${encodeURIComponent(siteId ?? '')}`)}><Sparkles size={16} /> Open Operations</button>
                <button className="button button--quiet" type="button" onClick={() => navigate(`/workforce/site-heat-intelligence?site=${encodeURIComponent(siteId ?? '')}`)}><ShieldCheck size={15} /> Inspect site heat evidence</button>
              </aside>
            </section>

            <section className="wf-command-strip panel">
              <div><span>Heat index</span><strong>{formatTemperature(data.conditions?.heatIndexC)}</strong><small>Atmospheric context</small></div>
              <div><span>Humidity</span><strong>{data.conditions?.humidityPercent == null ? '—' : `${data.conditions.humidityPercent.toFixed(0)}%`}</strong><small>Provider / atmospheric context</small></div>
              <div><span>High exposure</span><strong>{data.highExposureCount}</strong><small>Worker + site context</small></div>
              <div><span>Current site risk</span><strong className={`wf-risk-text wf-risk-text--${data.risk?.level ?? 'low'}`}>{data.risk?.level ?? 'unclassified'}</strong><small>{data.risk?.summary ?? 'No risk summary'}</small></div>
            </section>

            <section className="wf-command-lower-grid">
              <article className="wf-command-timeline panel">
                <div className="wf-section-head"><div><span className="wf-eyebrow">NEXT HOURS</span><h2>What changes next?</h2></div><small>Only operationally useful forecast points</small></div>
                {forecast.length ? <div className="wf-command-timeline__points">{forecast.map((point) => <div key={point.time}><time>{new Date(point.time).toLocaleTimeString('en-US', { hour: 'numeric' })}</time><strong>{formatTemperature(point.temperatureC)}</strong><span /></div>)}</div> : <div className="wf-compact-empty"><Info size={18} /><p>No verified forecast points are available in the current site response.</p></div>}
              </article>

              <article className="wf-attention-queue panel">
                <div className="wf-section-head"><div><span className="wf-eyebrow">ATTENTION QUEUE</span><h2>Who needs a decision?</h2></div><button className="button button--quiet" type="button" onClick={() => navigate(`/workforce/workforce?site=${encodeURIComponent(siteId ?? '')}`)}>View workforce</button></div>
                {attentionWorkers.length ? <div className="wf-attention-list">{attentionWorkers.slice(0, 5).map((worker) => <article key={worker.id}><div className="wf-worker-avatar">{worker.initials}</div><div><strong>{worker.name}</strong><p>{worker.task || worker.role} · {worker.location}</p></div><span className={`wf-choice-badge wf-choice-badge--${worker.risk}`}>{worker.risk}</span></article>)}</div> : <div className="wf-compact-empty wf-compact-empty--good"><CheckCircle2 size={19} /><div><strong>No worker currently needs intervention</strong><p>HeatShield will keep the queue empty until worker context supports a real action.</p></div></div>}
              </article>
            </section>

            {!activeWorkers.length && (
              <section className="wf-inline-notice panel"><UserPlus size={18} /><div><strong>No workers assigned yet</strong><p>Add actual workers and map positions so HeatShield can convert site heat evidence into worker-specific decisions.</p></div><button className="button button--secondary" type="button" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(siteId ?? '')}`)}>Add Worker</button></section>
            )}
          </>
        ) : null}

        {error && <div className="form-error wf-final-error"><AlertTriangle size={16} /> {error}</div>}
      </main>

      <CreateSiteModal open={createSiteOpen} onClose={() => setCreateSiteOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
