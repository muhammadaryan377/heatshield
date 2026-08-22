import { Bell, Building2, CalendarDays, ChevronDown, Search, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface TopbarProps {
  siteName: string
  observedAt: string
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Latest observation'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function Topbar({ siteName, observedAt }: TopbarProps) {
  const navigate = useNavigate()

  return (
    <header className="topbar">
      <h1 className="topbar__title">Site Intelligence</h1>
      <button className="topbar-control topbar-control--site" type="button">
        <Building2 size={16} />
        <span>{siteName}</span>
        <ChevronDown size={16} />
      </button>
      <button className="topbar-control topbar-control--date" type="button">
        <CalendarDays size={16} />
        <span>{formatTimestamp(observedAt)}</span>
      </button>
      <div className="topbar__spacer" />
      <label className="global-search">
        <Search size={18} />
        <input aria-label="Search HeatShield" placeholder="Search workers, sites, reports..." />
        <kbd>⌘K</kbd>
      </label>
      <button className="icon-button" type="button" aria-label="Notifications"><Bell size={20} /></button>
      <button className="button button--primary topbar__plan-button" onClick={() => navigate('/plan')}>
        <Sparkles size={17} />
        Generate Plan
      </button>
    </header>
  )
}
