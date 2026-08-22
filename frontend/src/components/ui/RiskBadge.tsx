import type { RiskLevel } from '../../types/site'

interface RiskBadgeProps {
  level: RiskLevel
  compact?: boolean
}

export function RiskBadge({ level, compact = false }: RiskBadgeProps) {
  const label = level.charAt(0).toUpperCase() + level.slice(1)
  return <span className={`risk-badge risk-badge--${level}${compact ? ' risk-badge--compact' : ''}`}>{label}</span>
}
