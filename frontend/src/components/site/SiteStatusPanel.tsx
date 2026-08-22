import { AlertTriangle, CloudOff, Droplets, ShieldAlert, ThermometerSun, UserRound, UsersRound } from 'lucide-react'
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

export function SiteStatusPanel({ data, onRefresh }: SiteStatusPanelProps) {
  const activeWorkers = data.workers.filter((worker) => worker.status !== 'offsite').length
  const conditions = data.conditions
  const riskLabel = data.risk ? data.risk.level.charAt(0).toUpperCase() + data.risk.level.slice(1) : '—'
  const source = data.conditionSourceLabel ?? (data.conditionSource === 'nws' ? 'National Weather Service' : data.conditionSource === 'fortyguard' ? 'FortyGuard' : 'Provider')
  const providerFooter = conditions ? `${data.isLive ? 'Live' : 'Verified'} • ${source}` : 'Awaiting provider'
  const statusLabel = conditions
    ? data.conditionSource === 'nws'
      ? 'Live • NWS conditions'
      : data.isLive ? 'Live • FortyGuard' : 'Recent • FortyGuard'
    : 'Waiting for live data'

  return (
    <section className="site-status panel">
      <div className="site-status__header">
        <div className="site-status__title-row">
          <h2>Site Status</h2>
          <span className={`live-indicator ${conditions ? '' : 'live-indicator--offline'}`}><span />{statusLabel}</span>
        </div>
        <button type="button" className="site-status__updated site-status__refresh" onClick={onRefresh}>Last updated: {clockLabel(data.observedAt)} ↻</button>
      </div>
      <h3 className="section-kicker">Environmental Intelligence</h3>

      {!conditions && (
        <div className="live-data-empty">
          <CloudOff size={21} />
          <div>
            <strong>No verified environmental observation is being shown</strong>
            <p>{data.statusMessage ?? 'HeatShield could not retrieve a verified condition source for this site.'}</p>
          </div>
          <button type="button" className="button button--quiet" onClick={onRefresh}>Retry live data</button>
        </div>
      )}

      {conditions && data.fallbackActive && (
        <div className="live-data-empty">
          <AlertTriangle size={19} />
          <div>
            <strong>Live atmospheric conditions verified by NWS</strong>
            <p>{data.thermalMessage ?? 'Current/recent FortyGuard thermal cells are not available for this site right now.'} HeatShield keeps the two sources separate and does not fabricate spatial hotspots.</p>
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
        <Metric icon={ThermometerSun} label="Temperature" value={conditions ? `${conditions.temperatureC.toFixed(1)}°C` : '—'} footer={providerFooter} tone="warm" />
        <Metric icon={Droplets} label="Humidity" value={conditions ? `${conditions.humidityPercent.toFixed(0)}%` : '—'} footer={providerFooter} tone="cool" />
        <Metric icon={ThermometerSun} label="Heat Index" value={conditions ? `${conditions.heatIndexC.toFixed(1)}°C` : '—'} footer={providerFooter} tone="danger" />
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--danger"><ShieldAlert size={16} /><span>Risk Level</span></div>
          <div className="metric-card__value metric-card__value--danger">{riskLabel}</div>
          <div className="metric-card__footer"><span>{data.risk ? `Calculated from ${source} conditions` : 'Awaiting verified conditions'}</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--cool"><UsersRound size={16} /><span>Workers Active</span></div>
          <div className="metric-card__value metric-card__value--cool">{activeWorkers}</div>
          <div className="metric-card__footer"><span>Assigned to this site</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--warm"><UserRound size={16} /><span>High Exposure</span></div>
          <div className="metric-card__value metric-card__value--warm">{data.highExposureCount}</div>
          <div className="metric-card__footer"><span>From assigned workers</span></div>
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
          <div><strong>Risk summary pending</strong><p>HeatShield will calculate site risk when verified environmental data is available.</p></div>
        </article>
      )}
    </section>
  )
}
