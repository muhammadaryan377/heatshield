import { Activity, AlertTriangle, CloudOff, Droplets, ShieldAlert, ThermometerSun, UserRound, UsersRound } from 'lucide-react'
import type { SiteIntelligence } from '../../types/site'

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

function Metric({ icon: Icon, label, value, footer, tone = '' }: { icon: typeof ThermometerSun; label: string; value: string; footer: string; tone?: string }) {
  return (
    <article className="metric-card">
      <div className={`metric-card__label ${tone ? `metric-card__label--${tone}` : ''}`}><Icon size={16} /><span>{label}</span></div>
      <div className={`metric-card__value ${tone ? `metric-card__value--${tone}` : ''}`}>{value}</div>
      <div className="metric-card__footer"><span>{footer}</span></div>
    </article>
  )
}

function thermalStatusLabel(data: SiteIntelligence) {
  if (data.thermalStatus === 'verified') return 'FortyGuard current thermal verified'
  if (data.thermalStatus === 'recent_verified') return 'FortyGuard recent thermal verified'
  if (data.thermalStatus === 'not_configured') return 'FortyGuard API key not configured'
  return 'FortyGuard current thermal pending'
}

export function SiteStatusPanel({ data, onRefresh }: SiteStatusPanelProps) {
  const activeWorkers = data.workers.filter((worker) => worker.status !== 'offsite').length
  const conditions = data.conditions
  const riskLabel = data.risk ? data.risk.level.charAt(0).toUpperCase() + data.risk.level.slice(1) : '—'
  const atmosphericSource = data.conditionSourceLabel ?? (data.conditionSource === 'nws' ? 'National Weather Service' : data.conditionSource === 'fortyguard' ? 'FortyGuard' : 'Provider')
  const atmosphericFooter = conditions
    ? data.conditionSource === 'nws'
      ? `Atmosphere • ${atmosphericSource} fallback`
      : `${data.isLive ? 'Current' : 'Recent'} • FortyGuard`
    : 'Awaiting verified atmosphere'
  const statusLabel = thermalStatusLabel(data)

  return (
    <section className="site-status panel">
      <div className="site-status__header">
        <div className="site-status__title-row">
          <h2>Site Status</h2>
          <span className={`live-indicator ${data.thermalStatus === 'unavailable' || data.thermalStatus === 'not_configured' ? 'live-indicator--offline' : ''}`}><span />{statusLabel}</span>
        </div>
        <button type="button" className="site-status__updated site-status__refresh" onClick={onRefresh}>Last updated: {clockLabel(data.observedAt)} ↻</button>
      </div>
      <h3 className="section-kicker">FortyGuard Thermal + Environmental Context</h3>

      <div className="live-data-empty">
        <Activity size={20} />
        <div>
          <strong>FortyGuard is HeatShield&apos;s primary spatial thermal source</strong>
          <p>{data.thermalStatus === 'verified' || data.thermalStatus === 'recent_verified'
            ? `Spatial thermal evidence is ${data.thermalStatus === 'verified' ? 'current' : 'recent'} and provider-verified${data.thermalObservedAt ? ` at ${clockLabel(data.thermalObservedAt)}` : ''}.`
            : data.thermalMessage ?? 'Current FortyGuard thermal cells are not available yet. HeatShield will not invent spatial heat cells.'}</p>
        </div>
      </div>

      {!conditions && (
        <div className="live-data-empty">
          <CloudOff size={21} />
          <div>
            <strong>No verified atmospheric observation is being shown</strong>
            <p>{data.statusMessage ?? 'HeatShield could not retrieve verified atmospheric context for this site.'}</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onRefresh}>Retry providers</button>
        </div>
      )}

      {conditions && data.fallbackActive && (
        <div className="live-data-empty">
          <AlertTriangle size={19} />
          <div>
            <strong>NWS is atmospheric fallback only</strong>
            <p>{data.thermalMessage ?? 'Current/recent FortyGuard thermal cells are not available for this site right now.'} The NWS values below provide site-level atmospheric context; they do not replace FortyGuard spatial cells or create synthetic hotspots.</p>
          </div>
        </div>
      )}

      {conditions && !data.fallbackActive && data.statusMessage && (
        <div className="live-data-empty">
          <AlertTriangle size={19} />
          <div><strong>Using the latest verified FortyGuard observation</strong><p>{data.statusMessage}</p></div>
        </div>
      )}

      <div className="metric-grid">
        <Metric icon={ThermometerSun} label="Temperature" value={conditions ? `${conditions.temperatureC.toFixed(1)}°C` : '—'} footer={atmosphericFooter} tone="warm" />
        <Metric icon={Droplets} label="Humidity" value={conditions ? `${conditions.humidityPercent.toFixed(0)}%` : '—'} footer={atmosphericFooter} tone="cool" />
        <Metric icon={ThermometerSun} label="Heat Index" value={conditions ? `${conditions.heatIndexC.toFixed(1)}°C` : '—'} footer={atmosphericFooter} tone="danger" />
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--danger"><ShieldAlert size={16} /><span>Risk Level</span></div>
          <div className="metric-card__value metric-card__value--danger">{riskLabel}</div>
          <div className="metric-card__footer"><span>{data.risk ? `Calculated from verified ${atmosphericSource} atmospheric context` : 'Awaiting verified conditions'}</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--cool"><UsersRound size={16} /><span>Workers Active</span></div>
          <div className="metric-card__value metric-card__value--cool">{activeWorkers}</div>
          <div className="metric-card__footer"><span>Assigned to this site</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--warm"><UserRound size={16} /><span>High Exposure</span></div>
          <div className="metric-card__value metric-card__value--warm">{data.highExposureCount}</div>
          <div className="metric-card__footer"><span>Worker context + verified heat index</span></div>
        </article>
      </div>

      {data.risk ? (
        <article className="risk-summary">
          <AlertTriangle size={20} />
          <div>
            <strong>Risk Summary</strong>
            <p>{data.risk.summary}</p>
            <p>{data.risk.detail}</p>
          </div>
        </article>
      ) : (
        <article className="risk-summary risk-summary--neutral">
          <CloudOff size={20} />
          <div><strong>Risk summary pending</strong><p>HeatShield will calculate site risk when verified environmental context is available.</p></div>
        </article>
      )}
    </section>
  )
}
