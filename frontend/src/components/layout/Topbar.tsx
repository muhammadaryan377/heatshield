import { Bell, Building2, CalendarDays, Plus, Search, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Site } from '../../types/site'

interface TopbarProps {
  sites: Site[]
  selectedSiteId: string | null
  observedAt?: string | null
  onSiteChange: (siteId: string) => void
  onCreateSite: () => void
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'No live observation yet'
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

export function Topbar({ sites, selectedSiteId, observedAt, onSiteChange, onCreateSite }: TopbarProps) {
  const navigate = useNavigate()

  return (
    <header className="topbar">
      <h1 className="topbar__title">Site Intelligence</h1>
      <label className="topbar-control topbar-control--site topbar-site-select">
        <Building2 size={16} />
        <select
          value={selectedSiteId ?? ''}
          onChange={(event) => event.target.value && onSiteChange(event.target.value)}
          aria-label="Select work site"
        >
          {!sites.length && <option value="">No sites yet</option>}
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </label>
      <button type="button" className="button button--quiet topbar-add-site" onClick={onCreateSite}>
        <Plus size={16} /> Add Site
      </button>
      <div className="topbar-control topbar-control--date">
        <CalendarDays size={16} />
        <span>{formatTimestamp(observedAt)}</span>
      </div>
      <div className="topbar__spacer" />
      <label className="global-search">
        <Search size={18} />
        <input aria-label="Search HeatShield" placeholder="Search workers, sites, reports..." />
        <kbd>⌘K</kbd>
      </label>
      <button className="icon-button" type="button" aria-label="Notifications"><Bell size={20} /></button>
      <button className="button button--primary topbar__plan-button" onClick={() => navigate('/plan')} disabled={!selectedSiteId}>
        <Sparkles size={17} />
        Generate Plan
      </button>
    </header>
  )
}
