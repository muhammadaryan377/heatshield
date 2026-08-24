import {
  Activity,
  Boxes,
  Building2,
  Droplets,
  Factory,
  FileText,
  Layers3,
  Map,
  MapPin,
  Repeat2,
  ShieldCheck,
  Sprout,
  Thermometer,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppShell, type HeatShieldModule } from '../components/layout/AppShell'

type LandingModule = Exclude<HeatShieldModule, 'workforce' | 'global'>

const modules: Record<LandingModule, {
  title: string
  description: string
  tiles: Array<{ title: string; detail: string; icon: typeof Activity }>
}> = {
  enterprise: {
    title: 'Enterprise Heat Intelligence',
    description: 'Translate FortyGuard thermal evidence into property, asset and portfolio decisions for facilities and industrial operations.',
    tiles: [
      { title: 'Property Heat Exposure', detail: 'Understand how heat is distributed across a site and which zones repeatedly carry higher exposure.', icon: Building2 },
      { title: 'Asset Intelligence', detail: 'Connect thermal conditions to critical assets, cooling systems and operational sensitivity.', icon: Boxes },
      { title: 'Industrial Analysis', detail: 'Evaluate data center and industrial heat context using a site-level evidence model.', icon: Factory },
      { title: 'Portfolio Risk', detail: 'Compare multiple properties using a consistent FortyGuard-first exposure framework.', icon: Layers3 },
      { title: 'Site Intelligence', detail: 'Keep site geometry, observations and thermal evidence connected in one operating view.', icon: MapPin },
      { title: 'Heat Risk Reports', detail: 'Produce reviewable reports that separate measured evidence from HeatShield recommendations.', icon: FileText },
    ],
  },
  agriculture: {
    title: 'Agriculture Heat Intelligence',
    description: 'Apply the same FortyGuard-first heat intelligence core to farms, fields, crop stress and field-work timing.',
    tiles: [
      { title: 'Farm Overview', detail: 'Organize field boundaries and thermal conditions by farm and operating area.', icon: Sprout },
      { title: 'Field Heat', detail: 'Inspect how heat varies spatially across a field instead of relying on one weather point.', icon: Map },
      { title: 'Crop Heat Stress', detail: 'Combine thermal evidence with crop context to identify where deeper agronomic analysis is needed.', icon: Thermometer },
      { title: 'Irrigation Planner', detail: 'Use heat timing as decision context for irrigation planning without replacing agronomic controls.', icon: Droplets },
      { title: 'Field Work Planner', detail: 'Plan outdoor work around heat conditions using the same worker-safety principles.', icon: Users },
      { title: 'Alerts', detail: 'Surface meaningful heat changes and operational thresholds with traceable source evidence.', icon: Activity },
    ],
  },
  urban: {
    title: 'Urban Heat Intelligence',
    description: 'Use FortyGuard thermal intelligence to understand districts, local heat islands and intervention outcomes.',
    tiles: [
      { title: 'Districts', detail: 'Define urban areas and compare thermal behavior using consistent spatial boundaries.', icon: MapPin },
      { title: 'Heat Islands', detail: 'Identify persistent localized heat patterns and compare them with surrounding areas.', icon: Thermometer },
      { title: 'Urban Analysis', detail: 'Bring thermal evidence into a structured city-scale investigation workflow.', icon: Map },
      { title: 'Interventions', detail: 'Track proposed cooling actions and connect them to the heat problem they are intended to solve.', icon: ShieldCheck },
      { title: 'Before / After', detail: 'Compare verified observations across time to evaluate whether conditions actually changed.', icon: Repeat2 },
      { title: 'Evidence Reports', detail: 'Package source observations, analysis and intervention outcomes into explainable reports.', icon: FileText },
    ],
  },
}

export function ModuleLandingPage({ module }: { module: LandingModule }) {
  const config = modules[module]

  return (
    <AppShell module={module}>
      <div className="topbar">
        <h1 className="topbar__title">{config.title}</h1>
        <div className="topbar__spacer" />
        <div className="module-core-status">
          <span className="module-core-status__dot" />
          <span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span>
        </div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </div>

      <main className="module-landing">
        <section className="module-landing__hero">
          <div>
            <span className="module-select-eyebrow">FORTYGUARD-CORE MODULE</span>
            <h1>{config.title}</h1>
            <p>{config.description}</p>
          </div>
          <div className="module-landing__core">
            <ShieldCheck size={24} />
            <div><small>PRIMARY HEAT FOUNDATION</small><strong>FortyGuard intelligence</strong></div>
          </div>
        </section>

        <section className="module-landing__grid" aria-label={`${config.title} capabilities`}>
          {config.tiles.map(({ title, detail, icon: Icon }) => (
            <article key={title} className="module-landing__tile">
              <span><Icon size={20} strokeWidth={1.8} /></span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </section>

        <div className="module-landing__note">
          This module shell is intentionally evidence-first: production calculations and decisions should be wired to verified FortyGuard outputs before AI-generated recommendations are enabled.
        </div>
      </main>
    </AppShell>
  )
}
