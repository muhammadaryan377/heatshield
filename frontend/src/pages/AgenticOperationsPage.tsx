import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  ThermometerSun,
  UserCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { agenticApi } from '../lib/agenticApi'
import { api } from '../lib/api'
import type { AgentOption, AgentTraceStep, AgentWorkerDecision, AgenticHeatPlan } from '../types/agentic'
import type { OperationalApproval, Site } from '../types/site'
import '../agentic-operations.css'

const DEFAULT_OFFSETS = [1, 3, 6, 9, 12]

function temp(value?: number | null) {
  if (value == null) return '—'
  const fahrenheit = value * 9 / 5 + 32
  return `${value.toFixed(1)}°C · ${fahrenheit.toFixed(0)}°F`
}

function timeLabel(value?: string | null) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function choiceLabel(choice: AgentWorkerDecision['recommendedChoice']) {
  if (choice === 'better_time') return 'Better Time'
  if (choice === 'better_place') return 'Better Place'
  if (choice === 'now') return 'Current Assignment'
  return 'Manual Review'
}

function candidateLabel(candidate: AgentOption) {
  if (candidate.option.kind === 'now') return 'Current Assignment'
  if (candidate.option.kind === 'better_time') return 'Better Time'
  return 'Better Place'
}

function selectedCandidate(decision: AgentWorkerDecision) {
  if (decision.recommendedChoice === 'review') return null
  return decision.candidates.find((candidate) => candidate.option.kind === decision.recommendedChoice) ?? null
}

function traceIcon(step: AgentTraceStep) {
  if (step.stage === 'observe') return <ThermometerSun size={15} />
  if (step.stage === 'generate') return <Sparkles size={15} />
  if (step.stage === 'constrain') return <ShieldCheck size={15} />
  if (step.stage === 'compare') return <Gauge size={15} />
  if (step.stage === 'critique') return <BrainCircuit size={15} />
  if (step.stage === 'propose') return <Target size={15} />
  return <RefreshCw size={15} />
}

function CandidateCard({ candidate, selected }: { candidate: AgentOption; selected: boolean }) {
  const option = candidate.option
  return (
    <article className={`agent-candidate${selected ? ' agent-candidate--selected' : ''}${!candidate.eligible ? ' agent-candidate--ineligible' : ''}`}>
      <div className="agent-candidate__head">
        <span>{candidateLabel(candidate)}</span>
        <strong>{candidate.eligible ? `${candidate.suitabilityScore}/100` : 'Not eligible'}</strong>
      </div>
      <h4>{option.zoneName ?? option.label}</h4>
      <div className="agent-candidate__temp">{temp(option.temperatureC)}</div>
      <div className="agent-candidate__meta">
        <span>{candidate.verifiedImprovementC != null && candidate.verifiedImprovementC > 0 ? `${candidate.verifiedImprovementC.toFixed(1)}°C verified reduction` : option.status.replace('_', ' ')}</span>
        <span>{option.sampledAt ? timeLabel(option.sampledAt) : 'No sampled time'}</span>
      </div>
      <p>{option.detail}</p>
      <ul>{candidate.constraintNotes.map((note) => <li key={note}>{note}</li>)}</ul>
    </article>
  )
}

export function AgenticOperationsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? '')
  const [plan, setPlan] = useState<AgenticHeatPlan | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [running, setRunning] = useState(false)
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
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
  }, [])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const canRun = Boolean(siteId && offsets.length && !running)

  const planStats = useMemo(() => {
    if (!plan) return null
    return {
      review: plan.workers.filter((item) => item.recommendedChoice === 'review').length,
      betterTime: plan.workers.filter((item) => item.recommendedChoice === 'better_time').length,
      betterPlace: plan.workers.filter((item) => item.recommendedChoice === 'better_place').length,
      highConfidence: plan.workers.filter((item) => item.confidenceLevel === 'high').length,
    }
  }, [plan])

  const changeSite = (next: string) => {
    setSiteId(next)
    setPlan(null)
    setApprovals({})
    setError(null)
    navigate(`/plan?site=${encodeURIComponent(next)}`, { replace: true })
  }

  const toggleOffset = (hour: number) => {
    setOffsets((current) => current.includes(hour) ? current.filter((item) => item !== hour) : [...current, hour].sort((a, b) => a - b))
    setPlan(null)
    setApprovals({})
  }

  const runAgent = async () => {
    if (!canRun) return
    setRunning(true)
    setError(null)
    setApprovals({})
    try {
      const result = await agenticApi.run(siteId, {
        offsetsHours: offsets,
        granularityMeters: resolution,
        minImprovementC: minImprovement,
      })
      setPlan(result)
      setSites((current) => current.map((site) => site.id === result.site.id ? result.site : site))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent run failed.')
    } finally {
      setRunning(false)
    }
  }

  const approve = async (decision: AgentWorkerDecision) => {
    if (!plan || decision.recommendedChoice === 'review') return
    const candidate = selectedCandidate(decision)
    if (!candidate) return
    const option = candidate.option
    const baseline = decision.candidates.find((item) => item.option.kind === 'now')?.option.temperatureC
    setApprovalBusy(decision.workerId)
    setError(null)
    try {
      const approval = await api.approveOperationalDecision(plan.site.id, {
        workerId: decision.workerId,
        choice: decision.recommendedChoice,
        targetTime: option.sampledAt,
        targetZoneId: option.zoneId,
        baselineTemperatureC: baseline,
        expectedTemperatureC: option.temperatureC,
        expectedReductionC: baseline != null && option.temperatureC != null ? baseline - option.temperatureC : undefined,
      })
      setApprovals((current) => ({ ...current, [decision.workerId]: approval }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Supervisor approval could not be recorded.')
    } finally {
      setApprovalBusy(null)
    }
  }

  const verify = async (decision: AgentWorkerDecision) => {
    if (!plan) return
    const approval = approvals[decision.workerId]
    if (!approval) return
    setApprovalBusy(decision.workerId)
    setError(null)
    try {
      const result = await api.verifyOperationalDecision(plan.site.id, approval.id)
      setApprovals((current) => ({ ...current, [decision.workerId]: result }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fresh FortyGuard verification failed.')
    } finally {
      setApprovalBusy(null)
    }
  }

  return (
    <AppShell module="workforce">
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        onSiteChange={changeSite}
        pageTitle="HeatShield Agent"
        pageSubtitle="Observe → reason → propose → supervisor approve → verify with fresh FortyGuard evidence."
        showAddSite={false}
      />

      <main className="agent-page">
        <section className="agent-hero panel">
          <div className="agent-hero__copy">
            <span className="agent-eyebrow"><Cpu size={14} /> AGENTIC DECISION CORE</span>
            <h1>An operational agent that can explain every decision it proposes.</h1>
            <p>HeatShield does not ask an LLM to invent a plan. It gathers verified thermal evidence, generates valid actions, applies worker and site constraints, compares outcomes, runs a bounded AI critique, requires supervisor approval, then verifies the result.</p>
          </div>
          <div className="agent-hero__mission">
            <span>MISSION</span>
            <strong>{plan?.mission ?? 'Minimize verified thermal exposure without violating operational constraints.'}</strong>
            <small><UserCheck size={14} /> Autonomy: supervisor-gated</small>
          </div>
        </section>

        {loadingSites ? (
          <section className="agent-state panel"><LoaderCircle className="agent-spin" size={24} /><div><strong>Loading agent workspace</strong><p>Reading sites and operational configuration…</p></div></section>
        ) : !sites.length ? (
          <section className="agent-state panel"><MapPin size={25} /><div><strong>No site available</strong><p>Create a real site boundary before running the agent.</p></div></section>
        ) : (
          <>
            <section className="agent-controls panel">
              <label><span>Site</span><select value={siteId} onChange={(event) => changeSite(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><small>{selectedSite?.address}</small></label>
              <label><span>Resolution</span><select value={resolution} onChange={(event) => { setResolution(Number(event.target.value) as 60 | 80 | 100); setPlan(null) }}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select><small>FortyGuard spatial granularity</small></label>
              <label><span>Minimum improvement</span><select value={minImprovement} onChange={(event) => { setMinImprovement(Number(event.target.value)); setPlan(null) }}><option value={0.5}>0.5°C</option><option value={1}>1.0°C</option><option value={2}>2.0°C</option><option value={3}>3.0°C</option></select><small>Gate for moving time/place</small></label>
              <div className="agent-offset-control"><span>Future checks</span><div>{DEFAULT_OFFSETS.map((hour) => <button key={hour} type="button" className={offsets.includes(hour) ? 'is-active' : ''} onClick={() => toggleOffset(hour)}>+{hour}h</button>)}</div><small>Only in-shift samples stay eligible</small></div>
              <button type="button" className="button button--primary agent-run" disabled={!canRun} onClick={() => void runAgent()}>{running ? <LoaderCircle className="agent-spin" size={17} /> : <BrainCircuit size={17} />}{running ? 'Agent is reasoning…' : plan ? 'Run Agent Again' : 'Run HeatShield Agent'}</button>
            </section>

            {running && !plan && <section className="agent-state panel"><BrainCircuit className="agent-pulse" size={25} /><div><strong>Agent loop in progress</strong><p>Collecting spatial evidence, generating candidate actions, applying constraints and running the bounded critic.</p></div></section>}

            {plan && (
              <>
                <section className="agent-loop panel">
                  <div className="agent-section-head"><div><span className="agent-eyebrow">EXECUTION LOOP</span><h2>Observe, reason, approve, verify</h2></div><span className={`agent-mode agent-mode--${plan.agentMode}`}>{plan.agentMode === 'bounded_ai' ? <Bot size={14} /> : <Cpu size={14} />}{plan.agentMode === 'bounded_ai' ? 'Bounded AI critic active' : 'Deterministic agent'}</span></div>
                  <div className="agent-loop__steps">{plan.executionLoop.map((step) => <article key={step.order} className={`agent-loop-step agent-loop-step--${step.status}`}><span>{step.order}</span><div><strong>{step.name}</strong><p>{step.detail}</p></div></article>)}</div>
                </section>

                <section className="agent-kpis">
                  <article className="panel"><span><ShieldCheck size={16} /> Evidence coverage</span><strong>{plan.evidenceCoveragePercent}%</strong><small>Active workers with verified/recent spatial baseline</small></article>
                  <article className="panel"><span><ThermometerSun size={16} /> Provider jobs</span><strong>{plan.providerRequestCount}</strong><small>Shared FortyGuard scans + environmental context</small></article>
                  <article className="panel"><span><UserCheck size={16} /> Active workers</span><strong>{plan.activeWorkerCount}</strong><small>Break/offsite workers excluded from decisions</small></article>
                  <article className="panel"><span><Route size={16} /> Better alternatives</span><strong>{(planStats?.betterTime ?? 0) + (planStats?.betterPlace ?? 0)}</strong><small>{planStats?.review ?? 0} require manual review</small></article>
                  <article className="panel"><span><Gauge size={16} /> High confidence</span><strong>{planStats?.highConfidence ?? 0}</strong><small>Transparent confidence model, not provider risk score</small></article>
                </section>

                {plan.warnings.length > 0 && <section className="agent-warning panel"><AlertTriangle size={17} /><div>{plan.warnings.slice(0, 6).map((warning) => <p key={warning}>{warning}</p>)}</div></section>}

                <section className="agent-worker-list">
                  <div className="agent-section-head"><div><span className="agent-eyebrow">AGENT DECISIONS</span><h2>Worker-by-worker proposals</h2><p>Every proposal shows candidate evidence, constraints, confidence and critic output before approval.</p></div></div>

                  {plan.workers.map((decision) => {
                    const approval = approvals[decision.workerId]
                    const selected = selectedCandidate(decision)
                    return <article key={decision.workerId} className="agent-worker panel">
                      <header className="agent-worker__header">
                        <div className="agent-worker__identity"><span>{decision.workerName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><h3>{decision.workerName}</h3><p>{decision.role} · {decision.task} · {decision.currentArea}</p></div></div>
                        <div className="agent-worker__badges"><span>{decision.evidenceFreshness.replaceAll('_', ' ')}</span><span className={`confidence confidence--${decision.confidenceLevel}`}>{decision.confidenceScore}/100 · {decision.confidenceLevel}</span></div>
                      </header>

                      <div className="agent-context-row">
                        <span>Workload <strong>{decision.workload ?? 'not configured'}</strong></span>
                        <span>Sun <strong>{decision.sunExposure ?? 'not configured'}</strong></span>
                        <span>Shade <strong>{decision.shadeAccess ?? 'not configured'}</strong></span>
                        <span>Water <strong>{decision.waterAccess == null ? 'not configured' : decision.waterAccess ? 'available' : 'not recorded'}</strong></span>
                        <span>Heat index <strong>{temp(decision.heatIndexC)}</strong></span>
                      </div>

                      <div className="agent-candidates">{decision.candidates.map((candidate) => <CandidateCard key={candidate.option.kind} candidate={candidate} selected={candidate.option.kind === decision.recommendedChoice} />)}</div>

                      <section className="agent-proposal">
                        <div className="agent-proposal__icon"><Target size={20} /></div>
                        <div><span>PROPOSED ACTION</span><h3>{choiceLabel(decision.recommendedChoice)}</h3><strong>{decision.recommendation}</strong><p>{decision.rationale}</p></div>
                        <div className="agent-proposal__gate"><small>Human gate</small><strong><UserCheck size={15} /> Supervisor approval required</strong></div>
                      </section>

                      <div className="agent-audit-grid">
                        <section className="agent-trace">
                          <div className="agent-card-title"><BrainCircuit size={16} /><div><strong>Auditable decision trace</strong><small>Visible reasoning steps, not hidden chain-of-thought</small></div></div>
                          <div className="agent-trace__list">{decision.trace.map((step, index) => <article key={`${step.stage}-${index}`} className={`agent-trace-step agent-trace-step--${step.status}`}><span>{traceIcon(step)}</span><div><strong>{step.title}</strong><p>{step.detail}</p><small>{step.evidence.join(' · ')}</small></div></article>)}</div>
                        </section>

                        <section className="agent-critic">
                          <div className="agent-card-title"><Bot size={16} /><div><strong>Bounded critic</strong><small>{decision.critique.source === 'deepseek' ? 'DeepSeek review' : 'Deterministic fallback'}</small></div></div>
                          <p>{decision.critique.assessment}</p>
                          <div className={`agent-critic__support${decision.critique.supportsRecommendation ? ' is-supported' : ' is-warning'}`}>{decision.critique.supportsRecommendation ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{decision.critique.supportsRecommendation ? 'Critic supports proposal' : 'Critic requests stronger supervisor review'}</div>
                          {decision.critique.riskFlags.length > 0 && <div><span>Risk flags</span><ul>{decision.critique.riskFlags.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                          {decision.critique.missingContext.length > 0 && <div><span>Missing context</span><ul>{decision.critique.missingContext.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                          {decision.critique.supervisorQuestion && <div className="agent-question"><strong>Supervisor check</strong><p>{decision.critique.supervisorQuestion}</p></div>}
                        </section>
                      </div>

                      <details className="agent-confidence">
                        <summary>Why confidence is {decision.confidenceScore}/100</summary>
                        <ul>{decision.confidenceFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
                      </details>

                      {decision.evidenceWarnings.length > 0 && <div className="agent-worker-warning"><AlertTriangle size={14} /> {decision.evidenceWarnings.join(' · ')}</div>}

                      <footer className="agent-action-bar">
                        <div><span>Next agent state</span><strong>{approval ? approval.status.replaceAll('_', ' ') : decision.recommendedChoice === 'review' ? 'manual review' : 'awaiting supervisor approval'}</strong></div>
                        {decision.recommendedChoice === 'review' ? (
                          <button type="button" className="button button--secondary" disabled>Manual review required</button>
                        ) : approval ? (
                          <button type="button" className="button button--secondary" disabled={approvalBusy === decision.workerId} onClick={() => void verify(decision)}>{approvalBusy === decision.workerId ? <LoaderCircle className="agent-spin" size={15} /> : <RefreshCw size={15} />} Verify with fresh FortyGuard</button>
                        ) : (
                          <button type="button" className="button button--primary" disabled={!selected || approvalBusy === decision.workerId} onClick={() => void approve(decision)}>{approvalBusy === decision.workerId ? <LoaderCircle className="agent-spin" size={15} /> : <ShieldCheck size={15} />} Approve proposed action</button>
                        )}
                      </footer>

                      {approval?.verificationMessage && <div className="agent-verification"><ArrowRight size={16} /><div><strong>{approval.status === 'verified' ? `Fresh verification: ${temp(approval.verifiedTemperatureC)}` : 'Verification status'}</strong><p>{approval.verificationMessage}</p>{approval.actualReductionC != null && <span>Observed reduction vs locked baseline: {approval.actualReductionC.toFixed(1)}°C</span>}</div></div>}
                    </article>
                  })}
                </section>
              </>
            )}
          </>
        )}

        {error && <div className="agent-error"><AlertTriangle size={16} /> {error}</div>}
      </main>
    </AppShell>
  )
}
