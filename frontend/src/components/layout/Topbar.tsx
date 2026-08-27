import { Bell, Building2, CalendarDays, Plus, Search, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Site } from '../../types/site'

interface TopbarProps {
  sites?: Site[]
  selectedSiteId?: string | null
  observedAt?: string | null
  onSiteChange?: (siteId: string) => void
  onCreateSite?: () => void
  pageTitle?: string
  pageSubtitle?: string
  showAddSite?: boolean
  showSiteSelector?: boolean
  showObservation?: boolean
  showSearch?: boolean
  showNotifications?: boolean
  showPlanButton?: boolean
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'No provider observation yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Provider observation available'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function Topbar({
  sites = [],
  selectedSiteId = null,
  observedAt,
  onSiteChange,
  onCreateSite,
  pageTitle = 'Site Intelligence',
  pageSubtitle,
  showAddSite = true,
  showSiteSelector = true,
  showObservation = true,
  showSearch = false,
  showNotifications = false,
  showPlanButton = true,
}: TopbarProps) {
  const navigate = useNavigate()

  return (
    <header className={`topbar${pageSubtitle ? ' topbar--with-subtitle' : ''}`}>
      <div className="topbar__title-group">
        <h1 className="topbar__title">{pageTitle}</h1>
        {pageSubtitle && <p>{pageSubtitle}</p>}
      </div>

      {showSiteSelector && (
        <label className="topbar-control topbar-control--site topbar-site-select">
          <Building2 size={16} />
          <select
            value={selectedSiteId ?? ''}
            onChange={(event) => event.target.value && onSiteChange?.(event.target.value)}
            aria-label="Select work site"
            disabled={!sites.length}
          >
            {!sites.length && <option value="">No sites yet</option>}
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
      )}

      {showAddSite && onCreateSite && (
        <button type="button" className="button button--quiet topbar-add-site" onClick={onCreateSite}>
          <Plus size={16} /> Add Site
        </button>
      )}

      {showObservation && (
        <div className="topbar-control topbar-control--date" title="Latest evidence timestamp returned for this workspace">
          <CalendarDays size={16} />
          <span>{formatTimestamp(observedAt)}</span>
        </div>
      )}

      <div className="topbar__spacer" />

      {showSearch && (
        <label className="global-search">
          <Search size={18} />
          <input aria-label="Search HeatShield" placeholder="Search workers, sites, reports..." />
          <kbd>⌘K</kbd>
        </label>
      )}

      {showNotifications && <button className="icon-button" type="button" aria-label="Notifications"><Bell size={20} /></button>}

      {showPlanButton && (
        <button
          className="button button--primary topbar__plan-button"
          onClick={() => selectedSiteId && navigate(`/plan?site=${encodeURIComponent(selectedSiteId)}`)}
          disabled={!selectedSiteId}
        >
          <Sparkles size={17} />
          Generate Plan
        </button>
      )}
    </header>
  )
}
