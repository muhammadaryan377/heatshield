import {
  BarChart3,
  ClipboardList,
  CircleHelp,
  History,
  Home,
  MapPin,
  PanelLeftClose,
  Settings,
  UserPlus,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { BrandLogo } from '../ui/BrandLogo'

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/workers/new', label: 'Add Worker', icon: UserPlus },
  { to: '/plan', label: 'Generate Plan', icon: ClipboardList },
  { to: '/sites', label: 'Sites', icon: MapPin },
  { to: '/heat-history', label: 'Heat History', icon: History },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

interface SidebarProps {
  hidden: boolean
  onHide: () => void
}

export function Sidebar({ hidden, onHide }: SidebarProps) {
  return (
    <aside className={`sidebar${hidden ? ' sidebar--hidden' : ''}`} aria-hidden={hidden}>
      <div className="sidebar__brand"><BrandLogo /></div>

      <button
        type="button"
        className="sidebar__hide-button"
        onClick={onHide}
        aria-label="Hide navigation sidebar"
        title="Hide sidebar"
      >
        <PanelLeftClose size={18} strokeWidth={1.9} />
      </button>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar__nav-item${isActive ? ' sidebar__nav-item--active' : ''}`}
            end={to === '/'}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button className="workspace-switcher" type="button">
          <span className="workspace-switcher__avatar">HS</span>
          <span className="workspace-switcher__text">
            <strong>HeatShield Ops</strong>
            <small>Enterprise Plan</small>
          </span>
          <span className="workspace-switcher__chevron">⌄</span>
        </button>
        <button className="support-link" type="button">
          <CircleHelp size={20} strokeWidth={1.8} />
          <span>Help &amp; Support</span>
          <span className="support-link__chevron">›</span>
        </button>
      </div>
    </aside>
  )
}
