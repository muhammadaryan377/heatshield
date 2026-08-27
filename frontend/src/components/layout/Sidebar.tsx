import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  Box,
  Building2,
  ClipboardList,
  Droplets,
  Factory,
  FileText,
  History,
  Home,
  Layers,
  Map,
  MapPin,
  PanelLeftClose,
  Repeat2,
  Sprout,
  Thermometer,
  UserPlus,
  Users,
} from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { contextualModuleRoute } from '../../lib/moduleContext'
import type { HeatShieldModule } from './AppShell'
import { BrandLogo } from '../ui/BrandLogo'

const moduleNavigation = {
  workforce: {
    label: 'Workforce Safety',
    workspace: 'HeatShield Workforce',
    nav: [
      { to: '/workforce', label: 'Operations', icon: Home, end: true },
      { to: '/agent?module=workforce', label: 'Command Agent', icon: Bot },
      { to: '/workers/new', label: 'Crew Setup', icon: UserPlus },
      { to: '/plan', label: 'HeatShield Agent', icon: ClipboardList },
      { to: '/sites', label: 'Site & Zones', icon: MapPin },
      { to: '/historical-intelligence', label: 'Historical Intelligence', icon: History },
      { to: '/reports', label: 'Heat Reports', icon: BarChart3 },
    ],
  },
  enterprise: {
    label: 'Enterprise',
    workspace: 'HeatShield Enterprise',
    nav: [
      { to: '/enterprise', label: 'Overview', icon: Home, end: true },
      { to: '/agent?module=enterprise', label: 'Command Agent', icon: Bot },
      { to: '/enterprise/sites', label: 'Sites', icon: MapPin },
      { to: '/enterprise/property-exposure', label: 'Property Heat Exposure', icon: Building2 },
      { to: '/enterprise/assets', label: 'Assets', icon: Box },
      { to: '/enterprise/industrial', label: 'Industrial Review', icon: Factory },
      { to: '/enterprise/portfolio-risk', label: 'Portfolio Priority', icon: Layers },
      { to: '/enterprise/reports', label: 'Heat Risk Reports', icon: FileText },
    ],
  },
  agriculture: {
    label: 'Agriculture',
    workspace: 'HeatShield Agriculture',
    nav: [
      { to: '/agriculture', label: 'Overview', icon: Home, end: true },
      { to: '/agent?module=agriculture', label: 'Command Agent', icon: Bot },
      { to: '/agriculture/farms', label: 'Farms', icon: Sprout },
      { to: '/agriculture/fields', label: 'Fields', icon: Map },
      { to: '/agriculture/crop-heat-stress', label: 'Crop Heat Screening', icon: Thermometer },
      { to: '/agriculture/irrigation', label: 'Irrigation Inspection', icon: Droplets },
      { to: '/agriculture/field-work', label: 'Field Work Planner', icon: Users },
      { to: '/agriculture/alerts', label: 'Alerts', icon: Bell },
    ],
  },
  urban: {
    label: 'Urban Intelligence',
    workspace: 'HeatShield Urban',
    nav: [
      { to: '/urban', label: 'Overview', icon: Home, end: true },
      { to: '/agent?module=urban', label: 'Command Agent', icon: Bot },
      { to: '/urban/districts', label: 'Districts', icon: MapPin },
      { to: '/urban/heat-islands', label: 'Heat Islands', icon: Thermometer },
      { to: '/urban/analysis', label: 'Urban Analysis', icon: BarChart3 },
      { to: '/urban/interventions', label: 'Interventions', icon: ClipboardList },
      { to: '/urban/before-after', label: 'Before / After', icon: Repeat2 },
    ],
  },
  global: {
    label: 'Platform',
    workspace: 'HeatShield Ops',
    nav: [
      { to: '/platform-readiness', label: 'Platform Readiness', icon: Activity, end: true },
      { to: '/reports', label: 'Heat Reports', icon: BarChart3, end: true },
    ],
  },
} satisfies Record<HeatShieldModule, {
  label: string
  workspace: string
  nav: Array<{ to: string; label: string; icon: typeof Home; end?: boolean }>
}>

interface SidebarProps {
  module: HeatShieldModule
  hidden: boolean
  onHide: () => void
}

export function Sidebar({ module, hidden, onHide }: SidebarProps) {
  const location = useLocation()
  const config = moduleNavigation[module]
  const routeFor = (to: string) => contextualModuleRoute(to, module, location.search)
  const workspaceHome = routeFor(config.nav[0]?.to ?? '/')

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

      <div className="sidebar__module-context">
        <span>{config.label}</span>
        <Link to="/" title="Back to module selection"><ArrowLeft size={15} /> All Modules</Link>
      </div>

      <nav className="sidebar__nav" aria-label={`${config.label} navigation`}>
        {config.nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={routeFor(to)}
            className={({ isActive }) => `sidebar__nav-item${isActive ? ' sidebar__nav-item--active' : ''}`}
            end={end}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        {module !== 'global' && (
          <Link className="platform-readiness-link" to="/platform-readiness" title="Check platform readiness">
            <Activity size={16} />
            <span><strong>Platform Readiness</strong><small>Providers &amp; workspace setup</small></span>
            <span aria-hidden="true">›</span>
          </Link>
        )}
        <Link className="workspace-switcher" to={workspaceHome} title={`Open ${config.workspace} home`}>
          <span className="workspace-switcher__avatar">HS</span>
          <span className="workspace-switcher__text">
            <strong>{config.workspace}</strong>
            <small>Verified-first intelligence</small>
          </span>
          <span className="workspace-switcher__chevron">›</span>
        </Link>
      </div>
    </aside>
  )
}
