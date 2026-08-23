import { Activity, ArrowRight, CheckCircle2, Gauge, MapPinned, ShieldCheck, ThermometerSun, X } from 'lucide-react'
import type { SiteIntelligence } from '../../types/site'

interface ReasoningDrawerProps {
  open: boolean
  data: SiteIntelligence
  onClose: () => void
}

function confidence(data: SiteIntelligence) {
  if (data.conditionSource === 'fortyguard' && data.thermalStatus === 'verified' && data.conditions) {
    return { label: 'High', detail: 'Current FortyGuard thermal evidence, atmospheric context, and worker records are all available.' }
  }
  if (data.conditionSource === 'fortyguard' && data.thermalStatus === 'recent_verified' && data.conditions) {
    return { label: 'Medium', detail: 'The latest verified FortyGuard observation is recent rather than current-hour.' }
  }
  if (data.conditions) {
    return { label: 'Medium', detail: 'Atmospheric conditions are verified, but current FortyGuard spatial cells are unavailable.' }
  }
  return { label: 'Limited', detail: 'A complete verified environmental evidence set is not currently available.' }
}

function riskLabel(value?: string | null) {
  if (!value) return 'Pending'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function ReasoningDrawer({ open, data, onClose }: ReasoningDrawerProps) {
  if (!open) return null

  const conditions = data.conditions
  const activeWorkers = data.workers.filter((worker) => worker.status !== 'offsite')
  const elevatedWorkers = activeWorkers.filter((worker) => worker.risk === 'medium' || worker.risk === 'high' || worker.risk === 'extreme')
  const highWorkers = activeWorkers.filter((worker) => worker.risk === 'high' || worker.risk === 'extreme')
  const confidenceState = confidence(data)
  const recommendation = data.nextAction?.title
    ?? (highWorkers.length ? 'Review and reassign high-exposure workers.' : elevatedWorkers.length ? 'Keep elevated-exposure workers under active review.' : 'Continue normal operations with routine monitoring.')

  return (
    <div className="reasoning-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside className="reasoning-drawer" role="dialog" aria-modal="true" aria-label="HeatShield decision reasoning">
        <header className="reasoning-drawer__header">
          <div>
            <span className="reasoning-drawer__eyebrow">HEATSHIELD DECISION TRACE</span>
            <h2>Why this recommendation?</h2>
            <p>Every decision is tied back to the verified evidence currently available for this site.</p>
          </div>
          <button type="button" className="reasoning-drawer__close" onClick={onClose} aria-label="Close reasoning"><X size={19} /></button>
        </header>

        <div className="reasoning-confidence">
          <ShieldCheck size={20} />
          <div><span>Decision confidence</span><strong>{confidenceState.label}</strong><p>{confidenceState.detail}</p></div>
        </div>

        <div className="reasoning-steps">
          <article>
            <span className="reasoning-step__number">01</span>
            <div className="reasoning-step__icon"><ThermometerSun size={18} /></div>
            <div><strong>Observe</strong><p>{conditions ? `${conditions.temperatureC.toFixed(1)}°C air temperature, ${conditions.heatIndexC.toFixed(1)}°C heat index and ${conditions.humidityPercent.toFixed(0)}% humidity.` : 'Verified environmental conditions are not currently available.'}</p></div>
          </article>
          <ArrowRight className="reasoning-step__arrow" size={16} />
          <article>
            <span className="reasoning-step__number">02</span>
            <div className="reasoning-step__icon"><Gauge size={18} /></div>
            <div><strong>Assess</strong><p>Site risk is <b>{riskLabel(data.risk?.level)}</b>. {activeWorkers.length} worker{activeWorkers.length === 1 ? '' : 's'} active; {highWorkers.length} currently high exposure.</p></div>
          </article>
          <ArrowRight className="reasoning-step__arrow" size={16} />
          <article>
            <span className="reasoning-step__number">03</span>
            <div className="reasoning-step__icon"><MapPinned size={18} /></div>
            <div><strong>Compare</strong><p>{data.deltas?.comparedAt ? `Compared with the verified observation at ${new Date(data.deltas.comparedAt).toLocaleString()}.` : 'No verified prior comparison is available in this response, so HeatShield does not invent a trend.'}</p></div>
          </article>
          <ArrowRight className="reasoning-step__arrow" size={16} />
          <article>
            <span className="reasoning-step__number">04</span>
            <div className="reasoning-step__icon"><Activity size={18} /></div>
            <div><strong>Decide</strong><p>{elevatedWorkers.length ? `${elevatedWorkers.length} worker${elevatedWorkers.length === 1 ? '' : 's'} need elevated-exposure attention based on heat plus worker context.` : 'No worker currently crosses the elevated-exposure threshold.'}</p></div>
          </article>
          <ArrowRight className="reasoning-step__arrow" size={16} />
          <article className="reasoning-step--final">
            <span className="reasoning-step__number">05</span>
            <div className="reasoning-step__icon"><CheckCircle2 size={18} /></div>
            <div><strong>Recommend</strong><p>{recommendation}</p></div>
          </article>
        </div>

        <div className="reasoning-evidence-grid">
          <div><span>Environmental source</span><strong>{data.conditionSourceLabel ?? 'Unavailable'}</strong></div>
          <div><span>Thermal status</span><strong>{data.thermalStatus.replace('_', ' ')}</strong></div>
          <div><span>Observation</span><strong>{data.observedAt ? new Date(data.observedAt).toLocaleString() : 'Unavailable'}</strong></div>
          <div><span>Worker records</span><strong>{data.workers.length} assigned</strong></div>
        </div>
      </aside>
    </div>
  )
}
