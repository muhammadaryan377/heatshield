import { AlertTriangle, Droplets, ShieldAlert, ThermometerSun, UserRound, UsersRound } from 'lucide-react'
import type { SiteIntelligence } from '../../types/site'
import { MetricCard } from '../ui/MetricCard'

interface SiteStatusPanelProps {
  data: SiteIntelligence
}

function clockLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Latest'
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function SiteStatusPanel({ data }: SiteStatusPanelProps) {
  const activeWorkers = data.workers.filter((worker) => worker.status !== 'offsite').length
  const riskLabel = data.risk.level.charAt(0).toUpperCase() + data.risk.level.slice(1)

  return (
    <section className="site-status panel">
      <div className="site-status__header">
        <div className="site-status__title-row">
          <h2>Site Status</h2>
          <span className="live-indicator"><span />{data.isLive ? 'Live' : 'Latest'}</span>
        </div>
        <span className="site-status__updated">Last updated: {clockLabel(data.observedAt)} ↻</span>
      </div>
      <h3 className="section-kicker">Environmental Intelligence</h3>
      <div className="metric-grid">
        <MetricCard
          icon={ThermometerSun}
          label="Temperature"
          value={`${data.conditions.temperatureC.toFixed(1)}°C`}
          tone="warm"
          footer={`${Math.abs(data.deltas.temperatureC).toFixed(1)}°C vs ${data.deltas.comparedAt}`}
          footerDirection={data.deltas.temperatureC >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          icon={Droplets}
          label="Humidity"
          value={`${data.conditions.humidityPercent.toFixed(0)}%`}
          tone="cool"
          footer={`${Math.abs(data.deltas.humidityPercent).toFixed(0)}% vs ${data.deltas.comparedAt}`}
          footerDirection={data.deltas.humidityPercent >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          icon={ThermometerSun}
          label="Heat Index"
          value={`${data.conditions.heatIndexC.toFixed(1)}°C`}
          tone="danger"
          footer={`${Math.abs(data.deltas.heatIndexC).toFixed(1)}°C vs ${data.deltas.comparedAt}`}
          footerDirection={data.deltas.heatIndexC >= 0 ? 'up' : 'down'}
        />
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--danger"><ShieldAlert size={16} /><span>Risk Level</span></div>
          <div className="metric-card__value metric-card__value--danger">{riskLabel}</div>
          <div className="metric-card__footer"><span>{data.risk.level === 'low' ? 'Routine monitoring' : 'Take action'}</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--cool"><UsersRound size={16} /><span>Workers Active</span></div>
          <div className="metric-card__value metric-card__value--cool">{activeWorkers}</div>
          <div className="metric-card__footer"><span>On site now</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label metric-card__label--warm"><UserRound size={16} /><span>High Exposure</span></div>
          <div className="metric-card__value metric-card__value--warm">{data.highExposureCount}</div>
          <div className="metric-card__footer"><span>Needs attention</span></div>
        </article>
      </div>
      <article className="risk-summary">
        <AlertTriangle size={20} />
        <div>
          <strong>Risk Summary</strong>
          <p>{data.risk.summary}</p>
          <p>{data.risk.detail}</p>
          <button type="button" className="text-link">View full forecast <span>›</span></button>
        </div>
      </article>
    </section>
  )
}
