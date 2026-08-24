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

function temp(value?: number | null) {
  if (value == null) return '—'
  const fahrenheit = value * 9 / 5 + 32
  return `${value.toFixed(1)}°C · ${fahrenheit.toFixed(0)}°F`
}

function timeLabel(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function sourceLabel(source?: 'fortyguard' | 'nws' | null) {
  if (source === 'fortyguard') return 'FortyGuard'
  if (source === 'nws') return 'NWS atmospheric context'
  return 'No atmospheric context'
}

function optionTone(option: OperationalPlannerOption) {
  if (option.status === 'verified' && option.deltaC != null && option.deltaC < 0) return 'better'
  if (option.status === 'verified') return 'verified'
  if (option.status === 'not_applicable') return 'neutral'
  return 'unavailable'
}

function reduction(option: OperationalPlannerOption) {
  if (option.deltaC == null) return null
  if (option.deltaC < 0) return `${Math.abs(option.deltaC).toFixed(1)}°C lower`
  if (option.deltaC > 0) return `${option.deltaC.toFixed(1)}°C higher`
  return 'Same sampled temperature'
}

function selectedOption(decision: WorkerOperationalDecision) {
  if (decision.recommendedChoice === 'better_time') return decision.betterTime
  if (decision.recommendedChoice === 'better_place') return decision.betterPlace
  if (decision.recommendedChoice === 'now') return decision.now
  return null
}

function OptionCard({ option, active }: { option: OperationalPlannerOption; active: boolean }) {
  const delta = reduction(option)
  return (
    <article className={`op-option op-option--${optionTone(option)}${active ? ' op-option--active' : ''}`}>
      <div className="op-option__top">
        <span>{option.kind === 'now' ? 'NOW' : option.kind === 'better_time' ? 'BETTER TIME' : 'BETTER PLACE'}</span>
        {active && <strong><Sparkles size={13} /> Recommended</strong>}
      </div>
      <h3>{option.kind === 'better_place' && option.zoneName ? option.zoneName : option.label}</h3>
      <div className="op-option__temperature">{temp(option.temperatureC)}</div>
      {delta && <span className={`op-option__delta${option.deltaC != null && option.deltaC < 0 ? ' op-option__delta--good' : ''}`}>{delta}</span>}
      <p>{option.detail}</p>
      <small>{option.sampledAt ? timeLabel(option.sampledAt) : option.status === 'unavailable' ? 'No verified sample' : 'No qualifying alternative'}</small>
    </article>
  )
}

function ReadinessItem({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  tone: 'ready' | 'limited' | 'blocked' | 'pending'
}) {
  return (
    <div className={`op-readiness-item op-readiness-item--${tone}`}>
      <div className="op-readiness-item__icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

export function GeneratePlanPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? '')
  const [workers, setWorkers] = useState<Worker[]>([])
  const [siteContext, setSiteContext] = useState<SiteIntelligence | null>(null)
  const [plan, setPlan] = useState<OperationalHeatPlan | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loadingContext, setLoadingContext] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolution, setResolution] = useState<60 | 80 | 100>(100)
  const [minImprovement, setMinImprovement] = useState(1)
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_OFFSETS)
  const [approvals, setApprovals] = useState<Record<string, OperationalApproval>>({})
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        setSiteId((current) => loaded.some((site) => site.id === current) ? current : loaded[0]?.id ?? '')
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!siteId) {
      setWorkers([])
      setSiteContext(null)
      return
    }

    const controller = new AbortController()
    setLoadingContext(true)
    setWorkers([])
    setSiteContext(null)

    Promise.allSettled([
      api.listWorkers(siteId, controller.signal),
      api.getSiteIntelligence(siteId, controller.signal),
    ]).then(([workersResult, contextResult]) => {
      if (controller.signal.aborted) return
      if (workersResult.status === 'fulfilled') setWorkers(workersResult.value)
      if (contextResult.status === 'fulfilled') setSiteContext(contextResult.value)
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingContext(false)
    })

    return () => controller.abort()
  }, [siteId])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const approvedZones = selectedSite?.zones.filter((zone) => zone.operationalApproved) ?? []
  const activeWorkers = workers.filter((worker) => worker.status === 'active')
  const planningReadyWorkers = activeWorkers.filter((worker) => Boolean(worker.task?.trim() && worker.coordinate))
  const workersNeedingSetup = Math.max(0, activeWorkers.length - planningReadyWorkers.length)
  const hasVerifiedContext = Boolean(siteContext?.conditions && siteContext.dataStatus === 'live')
  const generatedLabel = useMemo(() => plan ? timeLabel(plan.generatedAt) : 'Not run yet', [plan])

  const readinessTone = !activeWorkers.length || !offsets.length
    ? 'blocked'
    : !approvedZones.length || !hasVerifiedContext || workersNeedingSetup > 0
      ? 'limited'
      : 'ready'

  const readinessLabel = readinessTone === 'ready'
    ? 'Ready to generate recommendations'
    : readinessTone === 'blocked'
      ? 'Setup required before planning'
      : 'Ready with limited comparison coverage'

  const canRunPlanner = Boolean(siteId && offsets.length && activeWorkers.length && !generating && !loadingContext)

  const planSummary = useMemo(() => {
    if (!plan) return null
    const summary = {
      evaluated: plan.workers.length,
      betterTime: 0,
      betterPlace: 0,
      continueNow: 0,
      review: 0,
      bestReductionC: null as number | null,
    }

    plan.workers.forEach((decision) => {
      if (decision.recommendedChoice === 'better_time') summary.betterTime += 1
      else if (decision.recommendedChoice === 'better_place') summary.betterPlace += 1
      else if (decision.recommendedChoice === 'now') summary.continueNow += 1
      else summary.review += 1

      const option = selectedOption(decision)
      if (option?.temperatureC != null && decision.now.temperatureC != null) {
        const reductionC = decision.now.temperatureC - option.temperatureC
        if (reductionC > 0 && (summary.bestReductionC == null || reductionC > summary.bestReductionC)) {
          summary.bestReductionC = reductionC
        }
      }
    })

    return summary
  }, [plan])

  const changeSite = (nextId: string) => {
    setSiteId(nextId)
    setPlan(null)
    setApprovals({})
    setError(null)
    navigate(`/plan?site=${encodeURIComponent(nextId)}`, { replace: true })
  }

  const toggleOffset = (hour: number) => {
    setOffsets((current) => current.includes(hour) ? current.filter((item) => item !== hour) : [...current, hour].sort((a, b) => a - b))
    setPlan(null)
    setApprovals({})
  }

  const runPlanner = async () => {
    if (!siteId || !offsets.length || !activeWorkers.length) return
    setGenerating(true)
    setError(null)
    setApprovals({})
    try {
      const response = await api.generateOperationalPlanner(siteId, {
        offsetsHours: offsets,
        granularityMeters: resolution,
        minImprovementC: minImprovement,
      })
      setPlan(response)
      setSites((current) => current.map((site) => site.id === response.site.id ? response.site : site))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operational planner could not complete.')
    } finally {
      setGenerating(false)
    }
  }

  const approve = async (decision: WorkerOperationalDecision) => {
    if (!plan || decision.recommendedChoice === 'review') return
    const option = selectedOption(decision)
    if (!option) return
    setApprovalBusy(decision.workerId)
    setError(null)
    try {
      const approval = await api.approveOperationalDecision(plan.site.id, {
        workerId: decision.workerId,
        choice: decision.recommendedChoice,
        targetTime: option.sampledAt,
        targetZoneId: option.zoneId,
        baselineTemperatureC: decision.now.temperatureC,
        expectedTemperatureC: option.temperatureC,
        expectedReductionC: decision.now.temperatureC != null && option.temperatureC != null ? decision.now.temperatureC - option.temperatureC : undefined,
      })
      setApprovals((current) => ({ ...current, [decision.workerId]: approval }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record supervisor approval.')
    } finally {
      setApprovalBusy(null)
    }
  }

  const verify = async (decision: WorkerOperationalDecision) => {
    const approval = approvals[decision.workerId]
    if (!approval || !plan) return
    setApprovalBusy(decision.workerId)
    setError(null)
    try {
      const verified = await api.verifyOperationalDecision(plan.site.id, approval.id)
      setApprovals((current) => ({ ...current, [decision.workerId]: verified }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fresh verification could not complete.')
    } finally {
      setApprovalBusy(null)
    }
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        observedAt={siteContext?.observedAt}
        onSiteChange={changeSite}
        pageTitle="Operational Heat Planner"
        pageSubtitle="Compare NOW vs BETTER TIME vs BETTER PLACE for each worker using FortyGuard spatial evidence and supervisor-approved zones."
        showAddSite={false}
      />

      <div className="op-page op-page--hero">
        {loadingSites ? (
          <div className="plan-loading panel"><RefreshCw className="plan-spin" size={24} /><div><strong>Loading planning context</strong><p>Reading sites, workers and approved zones…</p></div></div>
        ) : !sites.length ? (
          <div className="plan-loading panel"><MapPin size={28} /><div><strong>Create a site before planning operations</strong><p>The planner needs a site boundary, workers and FortyGuard access.</p></div><button className="button button--primary" onClick={() => navigate('/')}>Go to Home</button></div>
        ) : (
          <>
            <section className="op-setup op-setup--hero panel">
              <div className="op-hero-head">
                <div className="op-setup__intro">
                  <span className="plan-section-label">FORTYGUARD DECISION SCAN</span>
                  <h2>What is the best heat-aware time and approved zone for each worker today?</h2>
                  <p>HeatShield compares current conditions with selected future windows and supervisor-approved work zones, then produces an evidence-bound recommendation for every active worker.</p>
                </div>
                <div className={`op-readiness-badge op-readiness-badge--${readinessTone}`}>
                  <span>{readinessTone === 'ready' ? 'READY' : readinessTone === 'blocked' ? 'ACTION REQUIRED' : 'LIMITED'}</span>
                  <strong>{readinessLabel}</strong>
                </div>
              </div>

              <div className="op-setup__stats op-setup__stats--decision">
                <div><span>Selected Site</span><strong>{selectedSite?.name ?? '—'}</strong><small>{selectedSite?.address || 'No site address'}</small></div>
                <div><span>Active Workers</span><strong>{activeWorkers.length}</strong><small>{workersNeedingSetup ? `${workersNeedingSetup} need task or location setup` : 'Worker context ready'}</small></div>
                <div><span>Approved Work Zones</span><strong>{approvedZones.length}</strong><small>{approvedZones.length ? 'Eligible for Better Place' : 'Better Place unavailable'}</small></div>
                <div><span>Future Time Checks</span><strong>{offsets.length}</strong><small>Up to {offsets.length + 1} shared provider jobs</small></div>
              </div>

              <div className="op-readiness-block">
                <div className="op-readiness-block__heading">
                  <div><span className="plan-section-label">PLANNER READINESS</span><h3>Inputs HeatShield will use</h3></div>
                  <small>Only verified provider evidence and supervisor-approved locations can drive recommendations.</small>
                </div>
                <div className="op-readiness-grid">
                  <ReadinessItem
                    icon={<UsersRound size={17} />}
                    label="Workers"
                    value={loadingContext ? 'Checking…' : `${activeWorkers.length} active`}
                    detail={!activeWorkers.length ? 'Add an active worker before planning.' : workersNeedingSetup ? `${workersNeedingSetup} worker profile${workersNeedingSetup === 1 ? '' : 's'} need task/location context.` : 'Task and map context available.'}
                    tone={loadingContext ? 'pending' : !activeWorkers.length ? 'blocked' : workersNeedingSetup ? 'limited' : 'ready'}
                  />
                  <ReadinessItem
                    icon={<ShieldCheck size={17} />}
                    label="Approved Zones"
                    value={`${approvedZones.length} configured`}
                    detail={approvedZones.length ? 'Better Place can compare approved alternatives.' : 'Better Time can still run; Better Place cannot.'}
                    tone={approvedZones.length ? 'ready' : 'limited'}
                  />
                  <ReadinessItem
                    icon={<ThermometerSun size={17} />}
                    label="Current Heat Context"
                    value={loadingContext ? 'Checking…' : hasVerifiedContext ? temp(siteContext?.conditions?.temperatureC) : 'Scan required'}
                    detail={hasVerifiedContext ? `Observed ${timeLabel(siteContext?.observedAt)}` : 'The planner will request fresh provider evidence when it runs.'}
                    tone={loadingContext ? 'pending' : hasVerifiedContext ? 'ready' : 'limited'}
                  />
                  <ReadinessItem
                    icon={<Clock3 size={17} />}
                    label="Future Windows"
                    value={`${offsets.length} selected`}
                    detail={offsets.length ? offsets.map((hour) => `+${hour}h`).join(' · ') : 'Select at least one future comparison window.'}
                    tone={offsets.length ? 'ready' : 'blocked'}
                  />
                </div>
              </div>

              <div className="op-controls op-controls--hero">
                <label>
                  <span>Spatial Resolution</span>
                  <select value={resolution} onChange={(event) => { setResolution(Number(event.target.value) as 60 | 80 | 100); setPlan(null) }}>
                    <option value={60}>60 m · detailed</option>
                    <option value={80}>80 m · balanced</option>
                    <option value={100}>100 m · efficient</option>
                  </select>
                </label>
                <label>
                  <span>Minimum Temperature Improvement</span>
                  <select value={minImprovement} onChange={(event) => { setMinImprovement(Number(event.target.value)); setPlan(null) }}>
                    <option value={0.5}>0.5°C</option>
                    <option value={1}>1.0°C</option>
                    <option value={2}>2.0°C</option>
                    <option value={3}>3.0°C</option>
                  </select>
                </label>
                <div className="op-offsets"><span>Future Time Checks</span><div>{DEFAULT_OFFSETS.map((hour) => <button type="button" key={hour} className={offsets.includes(hour) ? 'active' : ''} onClick={() => toggleOffset(hour)}>+{hour}h</button>)}</div></div>
                <button className="button button--primary op-run op-run--hero" type="button" disabled={!canRunPlanner} onClick={() => void runPlanner()}>
                  {generating ? <LoaderCircle className="plan-spin" size={17} /> : <Sparkles size={17} />}
                  {generating ? 'Analyzing FortyGuard evidence…' : plan ? 'Refresh Recommendations' : 'Generate Worker Recommendations'}
                </button>
              </div>

              {!activeWorkers.length && !loadingContext && (
                <div className="op-zone-warning op-zone-warning--critical">
                  <UsersRound size={18} />
                  <div><strong>Active workers are required</strong><p>Add and place at least one active worker before generating operational recommendations.</p></div>
                  <button type="button" className="button button--secondary" onClick={() => navigate(`/add-worker?site=${encodeURIComponent(siteId)}`)}>Add Worker</button>
                </div>
              )}

              {!approvedZones.length && (
                <div className="op-zone-warning">
                  <ShieldCheck size={18} />
                  <div><strong>Better Place recommendations need approved work zones</strong><p>The planner can still compare Better Time, but HeatShield will never suggest a random location.</p></div>
                  <button type="button" className="button button--secondary" onClick={() => navigate(`/sites?site=${encodeURIComponent(siteId)}`)}>Configure Zones</button>
                </div>
              )}
            </section>

            {generating && !plan && <div className="plan-loading panel"><ThermometerSun className="plan-spin" size={26} /><div><strong>Building worker-specific thermal choices</strong><p>Submitting shared site scans, joining worker coordinates to spatial evidence, and comparing approved zones…</p></div></div>}

            {!plan && !generating && activeWorkers.length > 0 && (
              <section className="op-pre-results panel">
                <div className="op-pre-results__icon"><Sparkles size={22} /></div>
                <div>
                  <span className="plan-section-label">DECISION OUTPUT</span>
                  <h3>Worker recommendations will appear here</h3>
                  <p>Each worker will receive a side-by-side NOW, BETTER TIME and BETTER PLACE comparison, followed by one evidence-bound supervisor action.</p>
                </div>
                <div className="op-pre-results__steps">
                  <span><strong>1</strong> Current worker exposure</span>
                  <span><strong>2</strong> Cooler time or approved zone</span>
                  <span><strong>3</strong> Supervisor approval and re-verification</span>
                </div>
              </section>
            )}

            {plan && (
              <>
                {planSummary && (
                  <section className="op-summary panel">
                    <div className="op-summary__heading">
                      <div><span className="plan-section-label">PLAN SUMMARY</span><h2>Worker Recommendations</h2></div>
                      <span>{generatedLabel} · {plan.timezoneName}</span>
                    </div>
                    <div className="op-summary__grid">
                      <div><span>Workers Evaluated</span><strong>{planSummary.evaluated}</strong><small>Active workers in this scan</small></div>
                      <div><span>Better Time</span><strong>{planSummary.betterTime}</strong><small>Delay or reschedule recommendations</small></div>
                      <div><span>Better Place</span><strong>{planSummary.betterPlace}</strong><small>Approved zone relocations</small></div>
                      <div><span>Continue Now</span><strong>{planSummary.continueNow}</strong><small>Current option remained best</small></div>
                      <div><span>Needs Review</span><strong>{planSummary.review}</strong><small>Insufficient or conflicting evidence</small></div>
                      <div><span>Best Expected Reduction</span><strong>{planSummary.bestReductionC != null ? `${planSummary.bestReductionC.toFixed(1)}°C` : '—'}</strong><small>Largest recommended reduction in this scan</small></div>
                    </div>
                  </section>
                )}

                <section className="op-evidence-strip panel">
                  <div><span><ShieldCheck size={15} /> FortyGuard scans</span><strong>{plan.providerRequestCount}</strong><small>Shared across {plan.workers.length} worker{plan.workers.length === 1 ? '' : 's'}</small></div>
                  <div><span><Gauge size={15} /> Heat-index context</span><strong>{plan.conditionHeatIndexC != null ? temp(plan.conditionHeatIndexC) : '—'}</strong><small>{sourceLabel(plan.conditionSource)}</small></div>
                  <div><span><MapPin size={15} /> Approved zones</span><strong>{plan.approvedZoneCount}</strong><small>Only these can become Better Place</small></div>
                  <div><span><Bot size={15} /> Decision mode</span><strong>{plan.agentMode === 'deepseek_assisted' ? 'DeepSeek assisted' : 'Deterministic'}</strong><small>Temperatures and choices remain evidence-bound</small></div>
                  <div><span><Clock3 size={15} /> Generated</span><strong>{generatedLabel}</strong><small>{plan.timezoneName}</small></div>
                </section>

                {plan.warnings.length > 0 && <section className="op-warnings panel"><AlertTriangle size={18} /><div>{plan.warnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}</div></section>}

                <section className="op-workers">
                  <div className="op-workers__heading"><div><span className="plan-section-label">WORKER-BY-WORKER DECISIONS</span><h2>Now vs Better Time vs Better Place</h2></div><span>{plan.workers.length} active worker{plan.workers.length === 1 ? '' : 's'}</span></div>

                  {!plan.workers.length ? <div className="plan-empty-workers panel"><UsersRound size={22} /><div><strong>No active workers assigned</strong><p>Add worker task, shift, workload and exact map location before running the planner.</p></div></div> : plan.workers.map((decision) => {
                    const approval = approvals[decision.workerId]
                    const option = selectedOption(decision)
                    return <article className="op-worker panel" key={decision.workerId}>
                      <header className="op-worker__header">
                        <div className="op-worker__identity"><span>{decision.workerName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><h3>{decision.workerName}</h3><p>{decision.role} · {decision.task} · {decision.currentArea}</p></div></div>
                        <div className="op-worker__context"><span>{decision.workload ?? 'workload n/a'}</span><span>{decision.sunExposure ?? 'sun exposure n/a'}</span>{decision.heatIndexC != null && <span>Heat index {decision.heatIndexC.toFixed(1)}°C</span>}</div>
                      </header>

                      <div className="op-options">
                        <OptionCard option={decision.now} active={decision.recommendedChoice === 'now'} />
                        <OptionCard option={decision.betterTime} active={decision.recommendedChoice === 'better_time'} />
                        <OptionCard option={decision.betterPlace} active={decision.recommendedChoice === 'better_place'} />
                      </div>

                      <div className="op-decision">
                        <div className="op-decision__icon"><Sparkles size={19} /></div>
                        <div className="op-decision__copy"><span>HEATSHIELD RECOMMENDATION</span><strong>{decision.recommendation}</strong><p>{decision.rationale}</p>{decision.evidenceWarnings.length > 0 && <small>{decision.evidenceWarnings.join(' · ')}</small>}</div>
                        <div className="op-decision__actions">
                          {decision.recommendedChoice === 'review' ? <button className="button button--secondary" type="button" disabled>Manual review required</button> : approval ? <>
                            <span className={`op-approval-status op-approval-status--${approval.status}`}><CheckCircle2 size={15} /> {approval.status.replace('_', ' ')}</span>
                            <button className="button button--secondary" type="button" disabled={approvalBusy === decision.workerId} onClick={() => void verify(decision)}>{approvalBusy === decision.workerId ? <LoaderCircle className="plan-spin" size={15} /> : <RefreshCw size={15} />} Verify with fresh FortyGuard</button>
                          </> : <button className="button button--primary" type="button" disabled={approvalBusy === decision.workerId || !option} onClick={() => void approve(decision)}>{approvalBusy === decision.workerId ? <LoaderCircle className="plan-spin" size={15} /> : <ShieldCheck size={15} />} Approve {decision.recommendedChoice.replace('_', ' ')}</button>}
                        </div>
                      </div>

                      {approval?.verificationMessage && <div className="op-verification"><ArrowRight size={16} /><div><strong>{approval.status === 'verified' ? `Verified ${temp(approval.verifiedTemperatureC)}` : 'Verification status'}</strong><p>{approval.verificationMessage}</p>{approval.actualReductionC != null && <span>Actual reduction: {approval.actualReductionC.toFixed(1)}°C</span>}</div></div>}
                    </article>
                  })}
                </section>
              </>
            )}
          </>
        )}

        {error && <div className="form-error op-error">{error}</div>}
      </div>
    </AppShell>
  )
}
