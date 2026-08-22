import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  CloudSun,
  Droplets,
  Gauge,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Sun,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api } from '../lib/api'
import type { OperationalPlan, RiskLevel, Site } from '../types/site'

function riskLabel(level: RiskLevel) {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function formatObservedAt(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Verified observation'
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function sourceLabel(source?: 'fortyguard' | 'nws' | null) {
  if (source === 'fortyguard') return 'FortyGuard'
  if (source === 'nws') return 'National Weather Service'
  return 'No verified source'
}

export function GeneratePlanPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? '')
  const [plan, setPlan] = useState<OperationalPlan | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        setSites(loaded)
        const preferred = loaded.some((site) => site.id === siteId) ? siteId : loaded[0]?.id ?? ''
        setSiteId(preferred)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Could not load sites.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
  }, [])

  const generate = useCallback(async (selectedId: string) => {
    if (!selectedId) return
    setGenerating(true)
    setError(null)
    setDeliveryMessage(null)
    try {
      const next = await api.generatePlan(selectedId)
      setPlan(next)
      setApproved(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the operational plan.')
    } finally {
      setGenerating(false)
    }
  }, [])

  useEffect(() => {
    if (siteId) void generate(siteId)
  }, [siteId, generate])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const generatedLabel = useMemo(() => plan ? formatObservedAt(plan.generatedAt) : 'Not generated', [plan])

  const changeSite = (nextId: string) => {
    setSiteId(nextId)
    navigate(`/plan?site=${encodeURIComponent(nextId)}`, { replace: true })
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        observedAt={plan?.inputs.observedAt}
        onSiteChange={changeSite}
        pageTitle="Generate Plan"
        pageSubtitle="Worker-specific operational heat safety plan generated from verified site conditions and saved worker exposure context."
        showAddSite={false}
      />

      <div className="plan-page">
        {loadingSites ? (
          <div className="plan-loading panel"><RefreshCw className="plan-spin" size={24} /><div><strong>Loading planning context</strong><p>Reading sites and worker assignments…</p></div></div>
        ) : !sites.length ? (
          <div className="plan-loading panel"><ClipboardCheck size={28} /><div><strong>Create a site before generating a plan</strong><p>The plan engine needs a site boundary and worker profiles.</p></div><button className="button button--primary" onClick={() => navigate('/')}>Go to Home</button></div>
        ) : generating && !plan ? (
          <div className="plan-loading panel"><Sparkles className="plan-spin" size={26} /><div><strong>Building worker-specific plan</strong><p>Checking verified conditions, worker exposure, task intensity, shade and water access…</p></div></div>
        ) : plan ? (
          <>
            <section className="plan-context panel">
              <div><span>Selected Site</span><strong>{plan.site.name}</strong><small>{plan.site.address}</small></div>
              <div><span>Condition Source</span><strong className="plan-source">{sourceLabel(plan.inputs.conditionSource)}</strong><small>{formatObservedAt(plan.inputs.observedAt)}</small></div>
              <div><span>Active Workers</span><strong>{plan.inputs.workerCount}</strong><small>{plan.inputs.highExposureWorkers} high/extreme exposure</small></div>
              <div><span>Current Conditions</span><strong>{plan.inputs.temperatureC != null ? `${plan.inputs.temperatureC.toFixed(1)}°C` : '—'}</strong><small>{plan.inputs.heatIndexC != null ? `Heat index ${plan.inputs.heatIndexC.toFixed(1)}°C` : 'No verified heat index'}</small></div>
              <div><span>Overall Risk</span><strong className={`plan-risk-text plan-risk-text--${plan.overallRisk}`}>{riskLabel(plan.overallRisk)}</strong><small>{plan.planStatus === 'ready' ? 'Operational controls ready' : 'Review limited inputs'}</small></div>
              <div><span>Plan Status</span><strong className="plan-ready"><CheckCircle2 size={16} /> {approved ? 'Approved' : 'Plan ready'}</strong><small>{generatedLabel}</small></div>
            </section>

            {plan.inputs.conditionSource === 'nws' && (
              <section className="plan-source-notice panel">
                <CloudSun size={20} />
                <div><strong>Live conditions are coming from NWS</strong><p>FortyGuard thermal tiles are currently unavailable. This plan does not invent site hotspots or spatial temperature differences; worker controls use verified atmospheric conditions plus recorded exposure context.</p></div>
              </section>
            )}

            <div className="plan-layout">
              <div className="plan-main-column">
                <section className="plan-risk-card panel">
                  <div className={`plan-risk-badge plan-risk-badge--${plan.overallRisk}`}><ShieldAlert size={27} /><div><strong>{riskLabel(plan.overallRisk)}</strong><span>Overall operational risk</span></div></div>
                  <div className="plan-risk-copy"><span className="plan-section-label">Operational Risk Summary</span><h2>{plan.riskHeadline}</h2><p>{plan.riskSummary}</p></div>
                </section>

                <section className="plan-worker-card panel">
                  <div className="plan-card-heading"><div><span className="plan-section-label">PRIMARY ACTION PLAN</span><h2>Worker-Specific Action Plan</h2></div><span>{plan.workers.length} active worker{plan.workers.length === 1 ? '' : 's'}</span></div>
                  {!plan.workers.length ? (
                    <div className="plan-empty-workers"><UsersRound size={22} /><div><strong>No active workers assigned</strong><p>Add workers with task and exposure details before approving a plan.</p></div></div>
                  ) : (
                    <div className="plan-worker-table-wrap">
                      <table className="plan-worker-table">
                        <thead><tr><th>Worker</th><th>Role / Area</th><th>Risk</th><th>Current Issue</th><th>Recommended Action</th><th>Window</th></tr></thead>
                        <tbody>{plan.workers.map((worker) => (
                          <tr key={worker.workerId}>
                            <td><strong>{worker.workerName}</strong></td>
                            <td><strong>{worker.role}</strong><small>{worker.area}</small></td>
                            <td><span className={`plan-risk-pill plan-risk-pill--${worker.riskLevel}`}>{worker.riskLevel}</span></td>
                            <td>{worker.currentIssue}</td>
                            <td><strong className="plan-action-copy">{worker.recommendedAction}</strong><small>{worker.rationale}</small></td>
                            <td>{worker.timeWindow}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </section>

                <div className="plan-bottom-grid">
                  <section className="plan-timeline panel">
                    <div className="plan-card-heading"><div><span className="plan-section-label">SHIFT CONTROL</span><h2>AI Plan Timeline</h2></div></div>
                    <div className="plan-timeline-list">{plan.timeline.map((item, index) => (
                      <div className="plan-timeline-item" key={`${item.time}-${item.title}`}>
                        <span className="plan-timeline-time">{item.time}</span><span className="plan-timeline-dot" />
                        <div><strong>{item.title}</strong><p>{item.detail}</p></div><span className={`plan-category plan-category--${item.category}`}>{item.category.replace('_', ' ')}</span>
                        {index < plan.timeline.length - 1 && <span className="plan-timeline-line" />}
                      </div>
                    ))}</div>
                  </section>

                  <section className="plan-site-actions panel">
                    <div className="plan-card-heading"><div><span className="plan-section-label">SITE CONTROLS</span><h2>Recommended Site Actions</h2></div></div>
                    <div className="plan-action-grid">{plan.siteActions.map((action) => (
                      <article key={action.id}><span className={`plan-priority plan-priority--${action.priority}`}>{action.priority}</span><strong>{action.title}</strong><p>{action.detail}</p></article>
                    ))}</div>
                  </section>
                </div>
              </div>

              <aside className="plan-side-column">
                <section className="plan-inputs panel">
                  <div className="plan-card-heading"><div><span className="plan-section-label">TRACEABLE INPUTS</span><h2>Plan Inputs</h2></div></div>
                  <dl>
                    <div><dt><CloudSun size={15} /> Conditions</dt><dd>{sourceLabel(plan.inputs.conditionSource)}</dd></div>
                    <div><dt><Gauge size={15} /> Heat Index</dt><dd>{plan.inputs.heatIndexC != null ? `${plan.inputs.heatIndexC.toFixed(1)}°C` : '—'}</dd></div>
                    <div><dt><Droplets size={15} /> Humidity</dt><dd>{plan.inputs.humidityPercent != null ? `${plan.inputs.humidityPercent.toFixed(0)}%` : '—'}</dd></div>
                    <div><dt><UsersRound size={15} /> Workers</dt><dd>{plan.inputs.workerCount}</dd></div>
                    <div><dt><AlertTriangle size={15} /> High Exposure</dt><dd>{plan.inputs.highExposureWorkers}</dd></div>
                    <div><dt><Sun size={15} /> Direct Sun</dt><dd>{plan.inputs.directSunWorkers}</dd></div>
                    <div><dt><ShieldAlert size={15} /> Heavy Work</dt><dd>{plan.inputs.heavyWorkWorkers}</dd></div>
                    <div><dt><ClipboardCheck size={15} /> FortyGuard Thermal</dt><dd>{plan.inputs.thermalStatus.replace('_', ' ')}</dd></div>
                  </dl>
                </section>

                <section className="plan-reasoning panel">
                  <div className="plan-card-heading"><div><span className="plan-section-label">DECISION EXPLANATION</span><h2>Agent Reasoning</h2></div></div>
                  <p>{plan.reasoning}</p>
                  <div className="plan-factor-list">{plan.reasoningFactors.map((factor) => <span key={factor}>{factor}</span>)}</div>
                </section>
              </aside>
            </div>

            <section className="plan-actions-bar panel">
              <div><span>Generated</span><strong>{generatedLabel}</strong>{deliveryMessage && <small>{deliveryMessage}</small>}</div>
              <div className="plan-actions-bar__buttons">
                <button className="button" type="button" onClick={() => void generate(siteId)} disabled={generating}><RefreshCw size={17} /> {generating ? 'Regenerating…' : 'Regenerate Plan'}</button>
                <button className={`button ${approved ? 'button--primary' : ''}`} type="button" onClick={() => setApproved((value) => !value)}><CheckCircle2 size={17} /> {approved ? 'Approved' : 'Approve Plan'}</button>
                <button className="button button--primary" type="button" onClick={() => setDeliveryMessage('Team delivery is not configured yet; no message was sent.')}><Send size={17} /> Send to Team</button>
              </div>
            </section>
          </>
        ) : null}

        {error && <div className="form-error plan-error">{error}</div>}
        {selectedSite && !plan && !generating && !error && <button className="button button--primary" onClick={() => void generate(selectedSite.id)}>Generate Plan</button>}
      </div>
    </AppShell>
  )
}
