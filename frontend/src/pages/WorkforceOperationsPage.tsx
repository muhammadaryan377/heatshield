import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
  UsersRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api } from '../lib/api'
import type {
  OperationalApproval,
  OperationalHeatPlan,
  OperationalPlannerOption,
  Site,
  SiteIntelligence,
  Worker,
  WorkerOperationalDecision,
} from '../types/site'

const DEFAULT_OFFSETS = [1, 3, 6, 9, 12]
const STORAGE_KEY = 'heatshield:selected-site'

function formatTemperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function recommendationOption(decision: WorkerOperationalDecision): OperationalPlannerOption | null {
  if (decision.recommendedChoice === 'better_time') return decision.betterTime
  if (decision.recommendedChoice === 'better_place') return decision.betterPlace
  if (decision.recommendedChoice === 'now') return decision.now
  return null
}

function optionImprovement(decision: WorkerOperationalDecision, option: OperationalPlannerOption) {
  if (decision.now.temperatureC == null || option.temperatureC == null) return null
  return decision.now.temperatureC - option.temperatureC
}

function optionName(option: OperationalPlannerOption) {
  if (option.kind === 'now') return 'Continue current work'
  if (option.kind === 'better_time') return option.sampledAt ? `Work at ${formatTime(option.sampledAt)}` : 'Use a cooler time'
  return option.zoneName ? `Move to ${option.zoneName}` : 'Use a cooler approved zone'
}

function optionStatus(option: OperationalPlannerOption) {
  if (option.status === 'verified') return 'FortyGuard verified'
  if (option.status === 'not_applicable') return 'No material improvement'
  return 'Evidence unavailable'
}

export function WorkforceOperationsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? localStorage.getItem(STORAGE_KEY) ?? '')
  const [workers, setWorkers] = useState<Worker[]>([])
  const [context, setContext] = useState<SiteIntelligence | null>(null)
  const [plan, setPlan] = useState<OperationalHeatPlan | null>(null)
  const [approvals, setApprovals] = useState<Record<string, OperationalApproval>>({})
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [busyWorker, setBusyWorker] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        setSiteId((current) => loaded.some((site) => site.id === current) ? current : loaded[0]?.id ?? '')
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!siteId) {
      setWorkers([])
      setContext(null)
      setPlan(null)
      setApprovals({})
      return
    }

    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    const controller = new AbortController()
    setError(null)
    setPlan(null)

    Promise.allSettled([
      api.listWorkers(siteId, controller.signal),
      api.getSiteIntelligence(siteId, controller.signal),
      api.listOperationalApprovals(siteId, controller.signal),
    ]).then(([workerResult, contextResult, approvalResult]) => {
      if (controller.signal.aborted) return
      if (workerResult.status === 'fulfilled') setWorkers(workerResult.value)
      if (contextResult.status === 'fulfilled') setContext(contextResult.value)
      if (approvalResult.status === 'fulfilled') {
        const latestByWorker: Record<string, OperationalApproval> = {}
        approvalResult.value.forEach((approval) => {
          const current = latestByWorker[approval.workerId]
          if (!current || approval.createdAt > current.createdAt) latestByWorker[approval.workerId] = approval
        })
        setApprovals(latestByWorker)
      }
    })

    return () => controller.abort()
  }, [siteId, setSearchParams])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const activeWorkers = workers.filter((worker) => worker.status === 'active')
  const approvedZones = selectedSite?.zones.filter((zone) => zone.operationalApproved) ?? []
  const readyWorkers = activeWorkers.filter((worker) => Boolean(worker.coordinate && (worker.task?.trim() || worker.role.trim())))

  const planSummary = useMemo(() => {
    if (!plan) return null
    const actions = plan.workers.filter((decision) => decision.recommendedChoice !== 'now' && decision.recommendedChoice !== 'review')
    const review = plan.workers.filter((decision) => decision.recommendedChoice === 'review')
    const continueNow = plan.workers.filter((decision) => decision.recommendedChoice === 'now')
    const pending = actions.filter((decision) => !approvals[decision.workerId]).length
    const approved = actions.length - pending
    const reductions = actions
      .map((decision) => {
        const option = recommendationOption(decision)
        return option ? optionImprovement(decision, option) : null
      })
      .filter((value): value is number => value != null && value > 0)
    return {
      actions,
      review,
      continueNow,
      pending,
      approved,
      bestReduction: reductions.length ? Math.max(...reductions) : null,
    }
  }, [approvals, plan])

  const planState = !plan
    ? 'Draft'
    : planSummary?.pending
      ? 'Review'
      : planSummary?.actions.length
        ? 'Approved'
        : 'Active'

  const runPlan = async () => {
    if (!siteId || !activeWorkers.length) return
    setPlanning(true)
    setError(null)
    try {
      const response = await api.generateOperationalPlanner(siteId, {
        offsetsHours: DEFAULT_OFFSETS,
        granularityMeters: 100,
        minImprovementC: 1,
      })
      setPlan(response)
      setSites((current) => current.map((site) => site.id === response.site.id ? response.site : site))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'HeatShield could not build the operational plan.')
    } finally {
      setPlanning(false)
    }
  }

  const approve = async (decision: WorkerOperationalDecision) => {
    if (!plan || decision.recommendedChoice === 'review') return
    const option = recommendationOption(decision)
    if (!option) return
    setBusyWorker(decision.workerId)
    setError(null)
    try {
      const approval = await api.approveOperationalDecision(plan.site.id, {
        workerId: decision.workerId,
        choice: decision.recommendedChoice,
        targetTime: option.sampledAt,
        targetZoneId: option.zoneId,
        baselineTemperatureC: decision.now.temperatureC,
        expectedTemperatureC: option.temperatureC,
        expectedReductionC: optionImprovement(decision, option),
      })
      setApprovals((current) => ({ ...current, [decision.workerId]: approval }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record supervisor approval.')
    } finally {
      setBusyWorker(null)
    }
  }

  const verify = async (decision: WorkerOperationalDecision) => {
    const approval = approvals[decision.workerId]
    if (!approval || !plan) return
    setBusyWorker(decision.workerId)
    setError(null)
    try {
      const verified = await api.verifyOperationalDecision(plan.site.id, approval.id)
      setApprovals((current) => ({ ...current, [decision.workerId]: verified }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fresh FortyGuard verification could not complete.')
    } finally {
      setBusyWorker(null)
    }
  }

  const timeline = useMemo(() => {
    if (!plan) return []
    return plan.workers.map((decision) => {
      const selected = recommendationOption(decision)
      return {
        id: decision.workerId,
        worker: decision.workerName,
        time: selected?.sampledAt ?? decision.now.sampledAt,
        choice: decision.recommendedChoice,
        recommendation: decision.recommendation,
      }
    }).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  }, [plan])

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        observedAt={context?.observedAt}
        onSiteChange={setSiteId}
        pageTitle="HeatShield Operations"
        pageSubtitle="FortyGuard evidence becomes worker-level operational decisions, supervisor approval and fresh verification."
        showAddSite={false}
        showPlanButton={false}
      />

      <main className="wf-final-page wf-operations">
        {loading ? (
          <section className="wf-state panel"><LoaderCircle className="wf-spin" size={24} /><div><strong>Loading operational context</strong><p>Reading sites, workers and approved zones.</p></div></section>
        ) : !sites.length ? (
          <section className="wf-state panel"><MapPin size={26} /><div><strong>Create a site before planning work</strong><p>HeatShield needs a saved work boundary before FortyGuard spatial evidence can be joined to workers.</p></div></section>
        ) : (
          <>
            <section className="wf-ops-hero panel">
              <div className="wf-ops-hero__copy">
                <span className="wf-eyebrow"><Bot size={14} /> AGENTIC OPERATIONS</span>
                <h2>What should change in today&apos;s work based on verified heat evidence?</h2>
                <p>HeatShield automatically checks NOW plus the next 1, 3, 6, 9 and 12 hours, compares supervisor-approved task-compatible zones, and ranks the strongest evidence-backed option for each active worker.</p>
              </div>
              <div className="wf-plan-lifecycle" aria-label="Operational plan lifecycle">
                {['Draft', 'Review', 'Approved', 'Active'].map((step) => <span key={step} className={step === planState ? 'active' : ''}>{step}</span>)}
              </div>
              <button className="button button--primary wf-primary-action" type="button" disabled={!activeWorkers.length || planning} onClick={() => void runPlan()}>
                {planning ? <LoaderCircle className="wf-spin" size={17} /> : <Sparkles size={17} />}
                {planning ? 'Evaluating FortyGuard evidence…' : plan ? 'Refresh Operational Plan' : 'Build Operational Plan'}
              </button>
            </section>

            <section className="wf-context-strip panel">
              <div><span>Site</span><strong>{selectedSite?.name ?? '—'}</strong><small>{selectedSite?.address || 'Saved work area'}</small></div>
              <div><span>Workers</span><strong>{activeWorkers.length}</strong><small>{readyWorkers.length} ready for spatial planning</small></div>
              <div><span>Approved zones</span><strong>{approvedZones.length}</strong><small>{approvedZones.length ? 'Better Place enabled' : 'Timing decisions still available'}</small></div>
              <div><span>Evidence</span><strong>{context?.thermalStatus === 'verified' || context?.thermalStatus === 'recent_verified' ? 'Verified' : 'Refresh on plan'}</strong><small>{formatTime(context?.thermalObservedAt ?? context?.observedAt)}</small></div>
            </section>

            {!activeWorkers.length && (
              <section className="wf-inline-notice wf-inline-notice--critical panel">
                <UsersRound size={19} />
                <div><strong>No active workers to plan</strong><p>Add and place a worker first. HeatShield will never fabricate worker context.</p></div>
                <button className="button button--secondary" type="button" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(siteId)}`)}>Add Worker</button>
              </section>
            )}

            {activeWorkers.length > 0 && !approvedZones.length && (
              <section className="wf-inline-notice panel">
                <ShieldCheck size={19} />
                <div><strong>Better Time is ready; Better Place is limited</strong><p>No approved alternative zone exists yet. HeatShield can still compare future time windows instead of blocking the whole plan.</p></div>
                <button className="button button--secondary" type="button" onClick={() => navigate(`/workforce/sites?site=${encodeURIComponent(siteId)}`)}>Configure Zones</button>
              </section>
            )}

            {planning && !plan && (
              <section className="wf-agent-scan panel">
                <div className="wf-agent-scan__pulse"><ThermometerSun size={21} /></div>
                <div><span className="wf-eyebrow">FORTYGUARD ORCHESTRATION</span><strong>Evaluating shared spatial scans</strong><p>Current cells → future windows → approved zones → environmental context → worker-specific option ranking.</p></div>
              </section>
            )}

            {!plan && !planning && activeWorkers.length > 0 && (
              <section className="wf-agent-empty panel">
                <Sparkles size={24} />
                <div><strong>One click builds the decision workspace</strong><p>No manual +1h / +3h configuration is required. HeatShield automatically evaluates the documented forecast horizon and returns only material worker decisions.</p></div>
              </section>
            )}

            {plan && planSummary && (
              <>
                <section className="wf-agent-brief panel">
                  <div className="wf-agent-brief__main">
                    <span className="wf-eyebrow"><Sparkles size={14} /> HEATSHIELD AGENT BRIEF</span>
                    <h2>{planSummary.actions.length ? `${planSummary.actions.length} operational decision${planSummary.actions.length === 1 ? '' : 's'} worth review` : 'No operational change is supported by the current evidence'}</h2>
                    <p>{planSummary.actions.length
                      ? `${planSummary.pending} decision${planSummary.pending === 1 ? '' : 's'} remain for supervisor review. ${planSummary.continueNow.length} worker${planSummary.continueNow.length === 1 ? '' : 's'} can continue the current assignment under the compared options.`
                      : 'Across current positions, future windows and approved alternatives, HeatShield did not find a material improvement above the configured 1.0°C decision threshold.'}</p>
                  </div>
                  <div className="wf-agent-brief__metrics">
                    <article><span>Actions</span><strong>{planSummary.actions.length}</strong><small>{planSummary.pending} pending approval</small></article>
                    <article><span>Continue</span><strong>{planSummary.continueNow.length}</strong><small>Current option remained strongest</small></article>
                    <article><span>Manual review</span><strong>{planSummary.review.length}</strong><small>Evidence incomplete or conflicting</small></article>
                    <article><span>Best reduction</span><strong>{planSummary.bestReduction == null ? '—' : `${planSummary.bestReduction.toFixed(1)}°C`}</strong><small>Across recommended alternatives</small></article>
                  </div>
                </section>

                <section className="wf-evidence-rail panel">
                  <div><ShieldCheck size={16} /><span>FortyGuard spatial scans</span><strong>{plan.providerRequestCount}</strong></div>
                  <div><Clock3 size={16} /><span>Forecast horizon</span><strong>NOW → +12h</strong></div>
                  <div><Gauge size={16} /><span>Heat-index context</span><strong>{formatTemperature(plan.conditionHeatIndexC)}</strong></div>
                  <div><MapPin size={16} /><span>Task-compatible zones</span><strong>{plan.approvedZoneCount}</strong></div>
                  <div><Bot size={16} /><span>Decision explanation</span><strong>{plan.agentMode === 'deepseek_assisted' ? 'AI assisted' : 'Deterministic'}</strong></div>
                </section>

                {plan.warnings.length > 0 && (
                  <section className="wf-inline-notice panel"><AlertTriangle size={19} /><div><strong>Evidence degraded gracefully</strong><p>{plan.warnings.slice(0, 2).join(' · ')}</p></div></section>
                )}

                <section className="wf-timeline panel">
                  <div className="wf-section-head"><div><span className="wf-eyebrow">OPERATIONAL TIMELINE</span><h2>When should work change?</h2></div><small>Derived from the selected option for each worker</small></div>
                  <div className="wf-timeline__list">
                    {timeline.map((item) => (
                      <article key={item.id} className={`wf-timeline__item wf-timeline__item--${item.choice}`}>
                        <time>{formatTime(item.time)}</time>
                        <div><strong>{item.worker}</strong><p>{item.recommendation}</p></div>
                        <span>{item.choice === 'better_place' ? 'MOVE' : item.choice === 'better_time' ? 'RESCHEDULE' : item.choice === 'now' ? 'CONTINUE' : 'REVIEW'}</span>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="wf-decisions">
                  <div className="wf-section-head"><div><span className="wf-eyebrow">WORKER DECISIONS</span><h2>Evidence → alternatives → supervisor action</h2></div><small>{plan.workers.length} worker{plan.workers.length === 1 ? '' : 's'} evaluated</small></div>

                  {plan.workers.map((decision) => {
                    const recommended = recommendationOption(decision)
                    const approval = approvals[decision.workerId]
                    const alternatives = [decision.now, decision.betterTime, decision.betterPlace]
                    return (
                      <article className="wf-decision-card panel" key={decision.workerId}>
                        <header className="wf-decision-card__header">
                          <div className="wf-worker-avatar">{decision.workerName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>
                          <div><h3>{decision.workerName}</h3><p>{decision.role} · {decision.task} · {decision.currentArea}</p></div>
                          <span className={`wf-choice-badge wf-choice-badge--${decision.recommendedChoice}`}>{decision.recommendedChoice.replace('_', ' ')}</span>
                        </header>

                        <div className="wf-option-grid">
                          {alternatives.map((option) => {
                            const active = recommended === option
                            const improvement = optionImprovement(decision, option)
                            return (
                              <article key={option.kind} className={`wf-option${active ? ' wf-option--recommended' : ''}`}>
                                <div className="wf-option__top"><span>{option.kind === 'now' ? 'CURRENT' : option.kind === 'better_time' ? 'ALTERNATIVE TIME' : 'ALTERNATIVE PLACE'}</span>{active && <strong><Sparkles size={12} /> Selected</strong>}</div>
                                <h4>{optionName(option)}</h4>
                                <strong className="wf-option__temperature">{formatTemperature(option.temperatureC)}</strong>
                                <span className="wf-option__status">{optionStatus(option)}</span>
                                {improvement != null && improvement > 0 && <b className="wf-option__gain">{improvement.toFixed(1)}°C lower than current</b>}
                                <p>{option.detail}</p>
                              </article>
                            )
                          })}
                        </div>

                        <div className="wf-decision-rationale">
                          <Sparkles size={18} />
                          <div><span>HEATSHIELD RECOMMENDATION</span><strong>{decision.recommendation}</strong><p>{decision.rationale}</p>{decision.evidenceWarnings.length > 0 && <small>{decision.evidenceWarnings.join(' · ')}</small>}</div>
                        </div>

                        <footer className="wf-decision-card__footer">
                          <button className="button button--quiet" type="button" onClick={() => navigate(`/workforce/site-heat-intelligence?site=${encodeURIComponent(siteId)}`)}><Gauge size={15} /> View site evidence</button>
                          <div className="wf-decision-card__actions">
                            {decision.recommendedChoice === 'review' ? (
                              <span className="wf-review-state"><AlertTriangle size={15} /> Manual review required</span>
                            ) : approval ? (
                              <>
                                <span className={`wf-approval-state wf-approval-state--${approval.status}`}><CheckCircle2 size={15} /> {approval.status.replaceAll('_', ' ')}</span>
                                <button className="button button--secondary" type="button" disabled={busyWorker === decision.workerId} onClick={() => void verify(decision)}>{busyWorker === decision.workerId ? <LoaderCircle className="wf-spin" size={15} /> : <RefreshCw size={15} />} Verify outcome</button>
                              </>
                            ) : (
                              <button className="button button--primary" type="button" disabled={!recommended || busyWorker === decision.workerId} onClick={() => void approve(decision)}>{busyWorker === decision.workerId ? <LoaderCircle className="wf-spin" size={15} /> : <ShieldCheck size={15} />} Approve decision</button>
                            )}
                          </div>
                        </footer>

                        {approval?.verificationMessage && (
                          <div className="wf-verification"><ArrowRight size={15} /><div><strong>{approval.status === 'verified' ? `Fresh FortyGuard result: ${formatTemperature(approval.verifiedTemperatureC)}` : 'Verification status'}</strong><p>{approval.verificationMessage}</p></div></div>
                        )}
                      </article>
                    )
                  })}
                </section>
              </>
            )}
          </>
        )}

        {error && <div className="form-error wf-final-error">{error}</div>}
      </main>
    </AppShell>
  )
}
