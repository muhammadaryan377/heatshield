import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Gauge,
  Layers3,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { filterUrbanDistricts } from '../lib/urbanDistricts'
import type { DomainAgentPlan, DomainModule } from '../types/domainAgent'
import type { Site } from '../types/site'
import '../command-agent.css'

const MODULES: Array<{ id: DomainModule; label: string; audience: string }> = [
  { id: 'workforce', label: 'Workforce Safety', audience: 'Site safety & operations supervisor' },
  { id: 'enterprise', label: 'Enterprise', audience: 'Facility, asset & portfolio manager' },
  { id: 'agriculture', label: 'Agriculture', audience: 'Farm & field operations manager' },
  { id: 'urban', label: 'Urban Intelligence', audience: 'Urban planner & resilience team' },
]

const storageKey: Record<DomainModule, string> = {
  workforce: 'heatshield:selected-site',
  enterprise: 'heatshield:selected-site',
  agriculture: 'heatshield:selected-agriculture-farm',
  urban: 'heatshield:selected-urban-district',
}

function validModule(value: string | null): DomainModule {
  return MODULES.some((item) => item.id === value) ? value as DomainModule : 'workforce'
}

function temp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function tone(score: number) {
  if (score >= 80) return 'high'
  if (score >= 55) return 'medium'
  return 'low'
}

function statusIcon(status: 'verified' | 'partial' | 'context' | 'unavailable') {
  if (status === 'verified') return <CheckCircle2 size={16} />
  if (status === 'partial' || status === 'context') return <CircleDot size={16} />
  return <AlertTriangle size={16} />
}

export function CommandAgentPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [module, setModule] = useState<DomainModule>(() => validModule(searchParams.get('module')))
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? '')
  const [loadingSites, setLoadingSites] = useState(true)
  const [running, setRunning] = useState(false)
  const [plan, setPlan] = useState<DomainAgentPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolution, setResolution] = useState<60 | 80 | 100>(100)
  const [threshold, setThreshold] = useState(35)

  useEffect(() => {
    const controller = new AbortController()
    setLoadingSites(true)
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load workspace sites.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSites(false)
      })
    return () => controller.abort()
  }, [])

  const moduleSites = useMemo(() => module === 'urban' ? filterUrbanDistricts(sites) : sites, [module, sites])

  useEffect(() => {
    if (!moduleSites.length) {
      setSiteId('')
      return
    }
    const requested = searchParams.get('site')
    const stored = localStorage.getItem(storageKey[module])
    const preferred = [requested, stored, siteId].find((id) => id && moduleSites.some((site) => site.id === id))
    const next = preferred ?? moduleSites[0].id
    setSiteId(next)
    localStorage.setItem(storageKey[module], next)
    setSearchParams({ module, site: next }, { replace: true })
    // Re-resolve whenever the module workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, moduleSites])

  const selectedSite = moduleSites.find((site) => site.id === siteId) ?? null
  const config = MODULES.find((item) => item.id === module) ?? MODULES[0]

  const changeModule = (next: DomainModule) => {
    setModule(next)
    setPlan(null)
    setError(null)
    const stored = localStorage.getItem(storageKey[next])
    setSearchParams(stored ? { module: next, site: stored } : { module: next }, { replace: true })
  }

  const changeSite = (next: string) => {
    setSiteId(next)
    localStorage.setItem(storageKey[module], next)
    setSearchParams({ module, site: next }, { replace: true })
    setPlan(null)
    setError(null)
  }

  const run = async () => {
    if (!siteId) return
    setRunning(true)
    setError(null)
    try {
      const response = await api.runDomainAgent(siteId, {
        module,
        granularityMeters: resolution,
        thresholdC: threshold,
      })
      setPlan(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'HeatShield Command Agent could not complete this mission.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <AppShell module={module}>
      <header className="command-agent-topbar">
        <div>
          <span>HEATSHIELD AI</span>
          <h1>Command Agent</h1>
          <p>One bounded decision agent, four domain toolkits, evidence-bound actions.</p>
        </div>
        <div className="command-agent-topbar__spacer" />
        <div className="command-agent-core"><ShieldCheck size={17} /><span><small>THERMAL EVIDENCE CORE</small><strong>FortyGuard</strong></span></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="command-agent-page">
        <section className="command-agent-hero panel">
          <div className="command-agent-hero__copy">
            <span className="command-agent-eyebrow"><Bot size={14} /> DOMAIN MISSION AGENT</span>
            <h2>{config.audience}</h2>
            <p>{plan?.mission ?? 'Select a real operating context, let HeatShield gather the right evidence and domain constraints, then review the next recommended action.'}</p>
          </div>

          <div className="command-agent-controls">
            <label>
              <span>Operating module</span>
              <select value={module} onChange={(event) => changeModule(event.target.value as DomainModule)}>
                {MODULES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>{module === 'agriculture' ? 'Farm' : module === 'urban' ? 'District' : 'Site'}</span>
              <select value={siteId} onChange={(event) => changeSite(event.target.value)} disabled={!moduleSites.length}>
                {!moduleSites.length && <option value="">No saved context</option>}
                {moduleSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
            </label>
            <label>
              <span>Spatial resolution</span>
              <select value={resolution} onChange={(event) => { setResolution(Number(event.target.value) as 60 | 80 | 100); setPlan(null) }}>
                <option value={60}>60 m · detailed</option>
                <option value={80}>80 m · balanced</option>
                <option value={100}>100 m · efficient</option>
              </select>
            </label>
            <label>
              <span>Screening threshold</span>
              <select value={threshold} onChange={(event) => { setThreshold(Number(event.target.value)); setPlan(null) }}>
                <option value={32}>32°C</option>
                <option value={35}>35°C</option>
                <option value={38}>38°C</option>
                <option value={40}>40°C</option>
              </select>
            </label>
            <button type="button" className="button button--primary command-agent-run" disabled={!siteId || running} onClick={() => void run()}>
              {running ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
              {running ? 'Running mission…' : plan ? 'Run Again' : 'Run Domain Agent'}
            </button>
          </div>
        </section>

        {loadingSites && <StatePanel kind="loading" title="Loading agent workspace" detail="Reading sites and module context…" />}
        {!loadingSites && !moduleSites.length && (
          <StatePanel
            kind="empty"
            title={`No ${module === 'urban' ? 'district' : module === 'agriculture' ? 'farm' : 'site'} is available`}
            detail="Create the real operating boundary first; HeatShield does not run a domain decision on synthetic geometry."
          />
        )}
        {error && <div className="command-agent-error"><AlertTriangle size={17} /><span>{error}</span></div>}

        {!plan && !running && selectedSite && (
          <section className="command-agent-ready panel">
            <div><BrainCircuit size={28} /><span><small>READY MISSION</small><strong>{selectedSite.name}</strong><p>Run the agent to gather module-specific evidence, rank candidates, apply constraints, critique the proposal and return one human-reviewable next action.</p></span></div>
            <div className="command-agent-loop">
              <span><strong>1</strong> Observe</span><ArrowRight size={13} />
              <span><strong>2</strong> Rank</span><ArrowRight size={13} />
              <span><strong>3</strong> Constrain</span><ArrowRight size={13} />
              <span><strong>4</strong> Critique</span><ArrowRight size={13} />
              <span><strong>5</strong> Propose</span>
            </div>
          </section>
        )}

        {running && !plan && <StatePanel kind="loading" title="HeatShield Agent is running" detail="Gathering provider evidence, domain records and operational constraints before proposing an action…" />}

        {plan && (
          <>
            <section className="command-agent-summary">
              <article className="panel"><span><Layers3 size={18} /> Evidence coverage</span><strong>{plan.evidenceCoveragePercent}%</strong><small>{plan.evidence.length} evidence feeds evaluated</small></article>
              <article className="panel"><span><Gauge size={18} /> Decision confidence</span><strong>{plan.decision.confidenceScore}/100</strong><small>{plan.decision.confidenceLevel} confidence</small></article>
              <article className="panel"><span><Bot size={18} /> Agent mode</span><strong>{plan.agentMode === 'bounded_ai' ? 'Bounded AI' : 'Deterministic agent'}</strong><small>LLM cannot invent provider values or candidate eligibility</small></article>
              <article className="panel"><span><RefreshCw size={18} /> Provider jobs</span><strong>{plan.providerRequestCount}</strong><small>Explicitly counted daily/agent evidence jobs</small></article>
            </section>

            <section className="command-agent-main-grid">
              <article className={`command-agent-decision panel command-agent-decision--${tone(plan.decision.confidenceScore)}`}>
                <div className="command-agent-card-head">
                  <div><span className="command-agent-eyebrow">RECOMMENDED NEXT ACTION</span><h2>{plan.decision.action}</h2></div>
                  <span className="command-agent-confidence">{plan.decision.confidenceScore}/100</span>
                </div>
                <p>{plan.decision.rationale}</p>
                <div className="command-agent-human-gate"><ShieldCheck size={17} /><span><strong>Human review required</strong><small>The agent proposes; the domain owner decides whether the action is appropriate.</small></span></div>
                <button type="button" className="button button--primary" onClick={() => navigate(plan.decision.nextRoute)}>
                  Open recommended workflow <ArrowRight size={15} />
                </button>
              </article>

              <article className="command-agent-critic panel">
                <div className="command-agent-card-head"><div><span className="command-agent-eyebrow">BOUNDED CRITIC</span><h2>{plan.decision.critique.source === 'deepseek' ? 'DeepSeek review' : 'Deterministic review'}</h2></div><BrainCircuit size={21} /></div>
                <p>{plan.decision.critique.assessment}</p>
                <div className="command-agent-critic__lists">
                  <div><strong>Risk flags</strong>{plan.decision.critique.riskFlags.length ? plan.decision.critique.riskFlags.map((item) => <span key={item}><AlertTriangle size={13} /> {item}</span>) : <span><CheckCircle2 size={13} /> No additional critic flags</span>}</div>
                  <div><strong>Missing context</strong>{plan.decision.critique.missingContext.length ? plan.decision.critique.missingContext.map((item) => <span key={item}><CircleDot size={13} /> {item}</span>) : <span><CheckCircle2 size={13} /> No material missing context reported</span>}</div>
                </div>
              </article>
            </section>

            <section className="command-agent-evidence panel">
              <div className="command-agent-card-head"><div><span className="command-agent-eyebrow">EVIDENCE PACKAGE</span><h2>What the agent actually used</h2></div><span>{plan.evidenceCoveragePercent}% coverage</span></div>
              <div className="command-agent-evidence__grid">
                {plan.evidence.map((item) => (
                  <article key={item.id} className={`command-agent-evidence-item command-agent-evidence-item--${item.status}`}>
                    <span>{statusIcon(item.status)}</span>
                    <div><strong>{item.label}</strong><small>{item.source}</small><p>{item.detail}</p></div>
                    <b>{item.status}</b>
                  </article>
                ))}
              </div>
            </section>

            <section className="command-agent-candidates panel">
              <div className="command-agent-card-head"><div><span className="command-agent-eyebrow">RANKED CANDIDATES</span><h2>What HeatShield considered</h2></div><span>{plan.candidates.length} candidates</span></div>
              {plan.candidates.length ? (
                <div className="command-agent-candidate-list">
                  {plan.candidates.map((candidate, index) => (
                    <article key={candidate.id} className={`command-agent-candidate${candidate.id === plan.decision.recommendedCandidateId ? ' is-recommended' : ''}`}>
                      <span className="command-agent-candidate__rank">{index + 1}</span>
                      <div className="command-agent-candidate__main">
                        <div><strong>{candidate.label}</strong><span>{candidate.entityType.replaceAll('_', ' ')}</span></div>
                        <p>{candidate.rationale}</p>
                        {candidate.constraints.length > 0 && <small>{candidate.constraints.join(' · ')}</small>}
                      </div>
                      <div className="command-agent-candidate__metrics">
                        <strong>{candidate.priorityScore}/100</strong>
                        <span>{temp(candidate.temperatureC)}</span>
                        {candidate.metricValue && <small>{candidate.metricLabel}: {candidate.metricValue}</small>}
                      </div>
                      <ChevronRight size={16} />
                    </article>
                  ))}
                </div>
              ) : <div className="command-agent-empty-candidates"><AlertTriangle size={18} /> No rankable candidates exist yet. The recommended action above explains the missing setup/evidence.</div>}
            </section>

            <section className="command-agent-trace panel">
              <div className="command-agent-card-head"><div><span className="command-agent-eyebrow">AUDITABLE AGENT TRACE</span><h2>Evidence-to-action checks</h2></div><span>Not hidden chain-of-thought</span></div>
              <div className="command-agent-trace__grid">
                {plan.trace.map((step) => (
                  <article key={`${step.order}-${step.stage}`} className={`command-agent-trace-step command-agent-trace-step--${step.status}`}>
                    <span>{step.order}</span>
                    <div><small>{step.stage.toUpperCase()}</small><strong>{step.title}</strong><p>{step.detail}</p></div>
                  </article>
                ))}
              </div>
            </section>

            {plan.warnings.length > 0 && (
              <section className="command-agent-warnings panel"><AlertTriangle size={18} /><div><strong>Evidence / setup limitations</strong>{plan.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}
