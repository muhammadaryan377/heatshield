import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  icon: LucideIcon
  label: string
  value: string
  tone: 'warm' | 'cool' | 'danger' | 'neutral'
  footer?: string
  footerDirection?: 'up' | 'down' | 'none'
}

export function MetricCard({ icon: Icon, label, value, tone, footer, footerDirection = 'none' }: MetricCardProps) {
  return (
    <article className="metric-card">
      <div className={`metric-card__label metric-card__label--${tone}`}>
        <Icon size={16} strokeWidth={2} />
        <span>{label}</span>
      </div>
      <div className={`metric-card__value metric-card__value--${tone}`}>{value}</div>
      {footer && (
        <div className={`metric-card__footer metric-card__footer--${footerDirection}`}>
          {footerDirection === 'up' && <span aria-hidden="true">↑</span>}
          {footerDirection === 'down' && <span aria-hidden="true">↓</span>}
          <span>{footer}</span>
        </div>
      )}
    </article>
  )
}
