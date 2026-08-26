import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, CloudOff, Database, Droplets, ShieldAlert, ShieldCheck, ThermometerSun, UserRound, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SiteIntelligence } from '../../types/site'
import { ReasoningDrawer } from './ReasoningDrawer'

interface SiteStatusPanelProps {
  data: SiteIntelligence
  onRefresh: () => void
}

function clockLabel(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Latest'
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function observationLabel(value?: string | null) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Metric({ icon: Icon, label, value, footer, tone = '' }: { icon: typeof ThermometerSun; label: string; value: string; footer: string; tone?: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-card__label ${tone ? `metric-card__label--${tone}` : ''}`}><Icon size={16} /><span>{label}</span></div>
      <div className={`metric-card__value ${tone ? `metric-card__value--${tone}` : ''}`}>{value}</div>
      <div className="metric-card__footer"><span>{footer}</span></div>
    </article>
  )
}

function deltaLabel(value?: number | null, suffix = '°C') {
  if (value == null) return 'No comparison'
  if (value === 0) return `0${suffix}`
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}${suffix}`
}

export function SiteStatusPanel({ data, onRefresh }: SiteStatusPanelProps) {
  const navigate = useNavigate()
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const activeWorkers = data.workers.filter((worker) => worker.status === 'active')
  const breakWorkers = data.workers.filter((worker) => worker.status === 'break')
  const highWorkers = activeWorkers.filter((worker) => worker.risk === 'high' || worker.risk === 'extreme')
  const elevatedWorkers = activeWorkers.filter((worker) => worker.risk === 'medium' || worker.risk === 'high' || worker.risk === 'extreme')
  const conditions = data.conditions
  const riskLabel = data.risk ? data.risk.level.charAt(0).toUpperCase() + data.risk.level.slice(1) : '—'
  const source = data.conditionSourceLabel ?? (data.conditionSource === 'nws' ? 'National Weather Service' : data.conditionSource === 'fortyguard' ? 'FortyGuard' : 'Provider')
  const providerFooter = conditions ? `${data.isLive ? 'Current' : 'Verified'} • ${source}` : 'Awaiting provider'
  const spatialVerified = data.conditionSource === 'fortyguard' && (data.thermalStatus === 'verified' || data.thermalStatus === 'recent_verified')
  const currentSpatialVerified = data.conditionSource === 'fortyguard' && data.thermalStatus === 'verified'
  const statusLabel = currentSpatialVerified
    ? 'FortyGuard current thermal verified'
    : data.conditionSource === 'fortyguard' && data.thermalStatus === 'recent_verified'
      ? 'FortyGuard recent thermal verified'
      : conditions ? `${source} environmental context` : 'Waiting for verified data'

  const decision = useMemo(() => {
    if (!conditions || !data.risk) {
      return {
        title: 'Waiting for verified conditions',
        detail: 'HeatShield will recommend an operational action after verified environmental data is available.',
        tone: 'pending',
        confidence: 'Limited',
        confidenceDetail: 'The evidence set is incomplete.',
      }
    }

    const confidence = currentSpatialVerified ? 'High' : spatialVerified ? 'Medium' : 'Context only'
    const confidenceDetail = currentSpatialVerified
      ? 'Current FortyGuard thermal evidence, environmental context, and worker records are available.'
      : spatialVerified
        ? 'The latest FortyGuard spatial evidence is verified but not current-hour.'
        : 'Verified environmental context is available, but current FortyGuard spatial evidence is limited.'

    if (highWorkers.length) {
      return {
        title: `Intervention recommended for ${highWorkers.length} worker${highWorkers.length === 1 ? '' : 's'}`,
        detail: 'Review high-exposure assignments and compare safer timing or approved-area options before changing operations.',
        tone: 'danger',
        confidence,
        confidenceDetail,
      }
    }
    if (elevatedWorkers.length) {
      return {
        title: 'Active exposure monitoring recommended',
        detail: `${elevatedWorkers.length} worker${elevatedWorkers.length === 1 ? ' is' : 's are'} at elevated screened exposure. Maintain hydration, shade and task-review controls.`,
        tone: 'watch',
        confidence,
        confidenceDetail,
      }
    }
    if (!spatialVerified) {
      return {
        title: 'No elevated worker signal; spatial evidence is limited',
        detail: 'Current environmental screening does not flag an active worker, but HeatShield will not declare normal operations without verified FortyGuard spatial evidence.',
        tone: 'watch',
        confidence,
        confidenceDetail,
      }
    }
    return {
      title: 'No operational change recommended from current evidence',
      detail: 'Verified heat evidence and current active-worker context do not indicate an exposure-driven reassignment at this review point. Continue normal site controls and monitoring.',
      tone: 'safe',
      confidence,
      confidenceDetail,
    }
  }, [conditions, currentSpatialVerified, data.risk, elevatedWorkers.length, highWorkers.length, spatialVerified])

  const nextReview = useMemo(() => {
    const base = data.observedAt ? new Date(data.observedAt) : new Date()
    if (Number.isNaN(base.getTime())) return 'Next verified update'
    base.setMinutes(base.getMinutes() + (data.nextAction?.dueInMinutes ?? 60))
    return base.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }, [data.nextAction?.dueInMinutes, data.observedAt])

  return (
    <>
      <section className="site-status site-status--command panel">
        <div className="site-status__header">
          <div className="site-status__title-row">
            <h2>Site Status</h2>
            <span className={`live-indicator ${conditions ? '' : 'live-indicator--offline'}`}><span />{statusLabel}</span>
          </div>
          <button type="button" className="site-status__updated site-status__refresh" onClick={onRefresh}>Updated: {clockLabel(data.observedAt)} ↻</button>
        </div>

        {!conditions && (
          <div className="live-data-empty">
            <CloudOff size={21} />
            <div><strong>No verified environmental observation is being shown</strong><p>{data.statusMessage ?? 'HeatShield could not retrieve a verified condition source for this site.'}</p></div>
            <button type="button" className="button button--quiet" onClick={onRefresh}>Retry</button>
          </div>
        )}

        <div className="metric-grid">
          <Metric icon={ThermometerSun} label="Temperature" value={conditions ? `${conditions.temperatureC.toFixed(1)}°C` : '—'} footer={providerFooter} tone="warm" />
          <Metric icon={ThermometerSun} label="Heat Index" value={conditions ? `${conditions.heatIndexC.toFixed(1)}°C` : '—'} footer={providerFooter} tone="danger" />
          <Metric icon={Droplets} label="Humidity" value={conditions ? `${conditions.humidityPercent.toFixed(0)}%` : '—'} footer={providerFooter} tone="cool" />
          <Metric icon={ShieldAlert} label="Risk Level" value={riskLabel} footer={data.risk ? 'HeatShield screening from verified environmental context' : 'Awaiting verified conditions'} tone={data.risk?.level === 'low' ? 'cool' : 'danger'} />
          <Metric icon={UsersRound} label="Workers Active" value={String(activeWorkers.length)} footer={breakWorkers.length ? `${breakWorkers.length} on break` : 'Currently working at this site'} tone="cool" />
          <Metric icon={UserRound} label="High Exposure" value={String(highWorkers.length)} footer="Active workers requiring review" tone="warm" />
        </div>

        <article className={`command-decision command-decision--${decision.tone}`}>
          <div className="command-decision__headline">
            <span className="command-decision__icon">{decision.tone === 'safe' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}</span>
            <div><span>Recommended Action</span><h3>{decision.title}</h3><p>{decision.detail}</p></div>
          </div>
          <div className="command-decision__meta">
            <div><CalendarClock size={14} /><span>Next review</span><strong>{nextReview}</strong></div>
            <div><UsersRound size={14} /><span>Affected active workers</span><strong>{elevatedWorkers.length}</strong></div>
            <div title={decision.confidenceDetail}><ShieldCheck size={14} /><span>Evidence depth</span><strong>{decision.confidence}</strong></div>
          </div>
          <div className="command-decision__actions">
            <button type="button" className="button button--secondary" onClick={() => setReasoningOpen(true)}>View reasoning</button>
            {activeWorkers.length > 0 && <button type="button" className="button button--primary" onClick={() => navigate(`/plan?site=${encodeURIComponent(data.site.id)}`)}>{elevatedWorkers.length ? 'Build response plan' : 'Review worker plan'}</button>}
          </div>
          <p className="command-decision__confidence-note"><ShieldCheck size={13} /> {decision.confidenceDetail}</p>
        </article>

        <article className="command-evidence">
          <button type="button" className="command-evidence__toggle" onClick={() => setEvidenceOpen((value) => !value)} aria-expanded={evidenceOpen}>
            <Database size={16} /><span><small>Environmental Source</small><strong>{source}</strong></span><ChevronRight className={evidenceOpen ? 'is-open' : ''} size={16} />
          </button>
          {evidenceOpen && (
            <div className="command-evidence__details">
              <div><span>Observation time</span><strong>{observationLabel(data.observedAt)}</strong></div>
              <div><span>FortyGuard thermal evidence</span><strong>{data.thermalStatus.replace('_', ' ')}</strong></div>
              <div><span>Fallback atmospheric context</span><strong>{data.fallbackActive ? 'Active' : 'Not active'}</strong></div>
              {data.thermalMessage && <p>{data.thermalMessage}</p>}
            </div>
          )}
        </article>

        <article className="change-strip">
          <div className="change-strip__header"><span>What Changed Since Last Verified Observation</span>{data.deltas?.comparedAt ? <small>Compared {observationLabel(data.deltas.comparedAt)}</small> : <small>No verified comparison yet</small>}</div>
          <div className="change-strip__grid">
            <div><span>Temperature</span><strong>{deltaLabel(data.deltas?.temperatureC)}</strong></div>
            <div><span>Heat Index</span><strong>{deltaLabel(data.deltas?.heatIndexC)}</strong></div>
            <div><span>Humidity</span><strong>{deltaLabel(data.deltas?.humidityPercent, '%')}</strong></div>
            <div><span>Spatial movement</span><strong>Not calculated</strong></div>
          </div>
        </article>
      </section>
      <ReasoningDrawer open={reasoningOpen} data={data} onClose={() => setReasoningOpen(false)} />
    </>
  )
}
