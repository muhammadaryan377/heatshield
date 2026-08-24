import { AlertTriangle, CheckCircle2, Database, FileText, Gauge, LoaderCircle, MapPin, Microscope, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api } from '../lib/api'
import type { FortyGuardUsageSummary } from '../types/fortyguard-advanced'
import type { OperationalApproval, Site, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'

function formatTemperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function choiceLabel(choice: OperationalApproval['choice']) {
  if (choice === 'better_time') return 'Better Time'
  if (choice === 'better_place') return 'Better Place'
  return 'Continue Now'
}

export function WorkforceAuditPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? localStorage.getItem(STORAGE_KEY) ?? '')
  const [approvals, setApprovals] = useState<OperationalApproval[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [usage, setUsage] = useState<FortyGuardUsageSummary | null>(null)
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
    if (!siteId) return
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    const controller = new AbortController()
    setError(null)
    Promise.allSettled([
      api.listOperationalApprovals(siteId, controller.signal),
      api.listWorkers(siteId, controller.signal),
      api.getFortyGuardUsage(controller.signal),
    ]).then(([approvalResult, workerResult, usageResult]) => {
      if (controller.signal.aborted) return
      if (approvalResult.status === 'fulfilled') setApprovals([...approvalResult.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      if (workerResult.status === 'fulfilled') setWorkers(workerResult.value)
      if (usageResult.status === 'fulfilled') setUsage(usageResult.value)
    })
    return () => controller.abort()
  }, [setSearchParams, siteId])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const workerMap = useMemo(() => new Map(workers.map((worker) => [worker.id, worker])), [workers])
  const verifiedCount = approvals.filter((approval) => approval.status === 'verified').length
  const pendingCount = approvals.filter((approval) => approval.status === 'pending_verification').length

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        onSiteChange={setSiteId}
        pageTitle="Reports & Audit"
        pageSubtitle="Provider evidence, HeatShield decisions, supervisor approvals and verification remain separated and traceable."
        showAddSite={false}
        showObservation={false}
        showPlanButton={false}
      />

      <main className="wf-final-page wf-audit-page">
        {loading ? (
          <section className="wf-state panel"><LoaderCircle className="wf-spin" size={24} /><div><strong>Loading audit records</strong><p>Reading operational approvals and provider usage.</p></div></section>
        ) : !sites.length ? (
          <section className="wf-state panel"><MapPin size={25} /><div><strong>No site records yet</strong><p>Create a site and run an operational plan before audit records can exist.</p></div></section>
        ) : (
          <>
            <section className="wf-audit-hero panel">
              <div><span className="wf-eyebrow"><ShieldCheck size={14} /> AUDITABLE AGENTIC AI</span><h2>Every action keeps provider facts, derived logic and human control distinct</h2><p>HeatShield does not turn missing provider data into claims. Operational records show what FortyGuard supplied, what HeatShield derived, and what a supervisor actually approved.</p></div>
              <div className="wf-audit-hero__stats">
                <article><span>Decision records</span><strong>{approvals.length}</strong><small>{selectedSite?.name ?? 'Selected site'}</small></article>
                <article><span>Verified outcomes</span><strong>{verifiedCount}</strong><small>Fresh provider re-check completed</small></article>
                <article><span>Awaiting verification</span><strong>{pendingCount}</strong><small>Approved actions not yet re-checked</small></article>
              </div>
            </section>

            <section className="wf-provider-coverage panel">
              <div className="wf-section-head"><div><span className="wf-eyebrow"><Database size={14} /> FORTYGUARD COVERAGE</span><h2>Where each provider capability enters Workforce Safety</h2></div><button className="button button--quiet" type="button" onClick={() => navigate(`/workforce/site-heat-intelligence?site=${encodeURIComponent(siteId)}`)}>Open evidence hub</button></div>
              <div className="wf-provider-coverage__grid">
                <article><CheckCircle2 size={17} /><div><strong>TCM spatial heat</strong><p>Command Center, worker joins and Operations comparisons.</p></div></article>
                <article><CheckCircle2 size={17} /><div><strong>+12h thermal forecast</strong><p>Better Time option generation in Operations.</p></div></article>
                <article><CheckCircle2 size={17} /><div><strong>Time of Measure</strong><p>Recurring peak windows in Site Heat Intelligence.</p></div></article>
                <article><CheckCircle2 size={17} /><div><strong>Exceedance + Persistence</strong><p>Repeated threshold burden and heat retention.</p></div></article>
                <article><Gauge size={17} /><div><strong>Environmental Parameters</strong><p>Heat index, wet bulb, AQI, humidity, solar and related context on demand.</p></div></article>
                <article><Microscope size={17} /><div><strong>Satellite + Street + Heat Intelligence</strong><p>Premium physical and deep context when a site question justifies the credit spend.</p></div></article>
              </div>
            </section>

            <div className="wf-audit-grid">
              <section className="wf-audit-log panel">
                <div className="wf-section-head"><div><span className="wf-eyebrow">SUPERVISOR DECISIONS</span><h2>Operational audit trail</h2></div><small>{approvals.length} record{approvals.length === 1 ? '' : 's'}</small></div>
                {!approvals.length ? <div className="wf-compact-empty"><FileText size={21} /><div><strong>No decision records yet</strong><p>Run Operations and approve a supported worker decision. It will appear here with its expected and verified thermal effect.</p></div></div> : <div className="wf-audit-log__list">{approvals.map((approval) => {
                  const worker = workerMap.get(approval.workerId)
                  return <article key={approval.id}>
                    <div className="wf-worker-avatar">{worker?.initials ?? 'HS'}</div>
                    <div className="wf-audit-log__copy"><span>{choiceLabel(approval.choice)} · {formatTime(approval.createdAt)}</span><strong>{worker?.name ?? approval.workerId}</strong><p>Baseline {formatTemperature(approval.baselineTemperatureC)} → expected {formatTemperature(approval.expectedTemperatureC)}{approval.expectedReductionC != null ? ` · ${approval.expectedReductionC.toFixed(1)}°C expected reduction` : ''}</p>{approval.verificationMessage && <small>{approval.verificationMessage}</small>}</div>
                    <span className={`wf-approval-state wf-approval-state--${approval.status}`}>{approval.status.replaceAll('_', ' ')}</span>
                  </article>
                })}</div>}
              </section>

              <aside className="wf-credit-panel panel">
                <span className="wf-eyebrow"><Sparkles size={14} /> CREDIT-AWARE ORCHESTRATION</span>
                <h2>Provider usage health</h2>
                {usage?.dataStatus === 'verified' ? <>
                  <div className="wf-credit-panel__meter"><span style={{ width: usage.monthlyCredits && usage.usedCredits != null ? `${Math.min(100, Math.max(0, usage.usedCredits / usage.monthlyCredits * 100))}%` : '0%' }} /></div>
                  <div className="wf-credit-panel__numbers"><article><span>Used</span><strong>{usage.usedCredits ?? '—'}</strong></article><article><span>Remaining</span><strong>{usage.remainingCredits ?? '—'}</strong></article><article><span>Plan</span><strong>{usage.plan ?? '—'}</strong></article></div>
                  <p>HeatShield shares site-wide scans across workers and keeps segmentation / Heat Intelligence on demand, so expensive provider calls are not repeated for decorative UI.</p>
                </> : <div className="wf-compact-empty"><AlertTriangle size={18} /><div><strong>Usage endpoint not verified</strong><p>{usage?.message ?? 'Provider usage details are unavailable. Operational evidence remains usable.'}</p></div></div>}
              </aside>
            </div>
          </>
        )}
        {error && <div className="form-error wf-final-error">{error}</div>}
      </main>
    </AppShell>
  )
}
