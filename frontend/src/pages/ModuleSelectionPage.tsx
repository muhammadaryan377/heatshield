import {
  ArrowRight,
  BarChart3,
  Bell,
  BrainCircuit,
  CheckCircle2,
  Factory,
  Layers3,
  LockKeyhole,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '../components/ui/BrandLogo'
import '../module-selection.css'
import '../module-selection-artwork.css'

const primaryModules = [
  {
    id: 'workforce',
    title: 'Workforce Safety',
    description: 'Protect crews with site heat intelligence, worker exposure context, risk decisions and AI-assisted plans.',
    route: '/workforce',
    artwork: '/module-artwork/workforce.webp',
    capability: 'Workers · Heat Map · Risk · AI Plans',
  },
  {
    id: 'enterprise',
    title: 'Enterprise',
    description: 'Turn FortyGuard heat intelligence into property, asset and portfolio-level thermal exposure decisions.',
    route: '/enterprise',
    artwork: '/module-artwork/enterprise.webp',
    capability: 'Sites · Assets · Portfolio Risk',
  },
  {
    id: 'agriculture',
    title: 'Agriculture',
    description: 'Understand field heat conditions, crop stress and operational timing using the same thermal intelligence core.',
    route: '/agriculture',
    artwork: '/module-artwork/agriculture.webp',
    capability: 'Fields · Crop Stress · Irrigation',
  },
  {
    id: 'urban',
    title: 'Urban Intelligence',
    description: 'Analyze districts, heat islands and interventions with evidence that stays traceable to the thermal source.',
    route: '/urban',
    artwork: '/module-artwork/urban.webp',
    capability: 'Districts · Heat Islands · Interventions',
  },
] as const

const platformSignals = [
  {
    icon: ShieldCheck,
    title: 'FortyGuard Core',
    detail: 'Thermal and environmental evidence stays at the center of every module.',
  },
  {
    icon: BrainCircuit,
    title: 'Decision Intelligence',
    detail: 'Reasoning sits above measured evidence instead of replacing it.',
  },
  {
    icon: Layers3,
    title: 'One Intelligence Layer',
    detail: 'Workers, assets, fields and districts share the same heat intelligence foundation.',
  },
  {
    icon: LockKeyhole,
    title: 'Evidence First',
    detail: 'Recommendations remain explainable, reviewable and operationally traceable.',
  },
] as const

export function ModuleSelectionPage() {
  return (
    <div className="module-select-page">
      <header className="module-select-header">
        <div className="module-select-header__brand">
          <BrandLogo />
          <span className="module-select-header__descriptor">Heat Intelligence Platform</span>
        </div>

        <div className="module-select-header__actions">
          <div className="module-core-status" title="HeatShield is designed around FortyGuard thermal intelligence">
            <span className="module-core-status__dot" />
            <span>
              <small>INTELLIGENCE CORE</small>
              <strong>FortyGuard</strong>
            </span>
          </div>
          <button type="button" className="module-header-icon" aria-label="Notifications">
            <Bell size={19} strokeWidth={1.8} />
            <span className="module-header-icon__dot" />
          </button>
          <div className="module-user-card" aria-label="Current workspace">
            <span className="module-user-card__avatar">HS</span>
            <span>
              <strong>HeatShield Ops</strong>
              <small>Enterprise workspace</small>
            </span>
          </div>
        </div>
      </header>

      <main className="module-select-main">
        <section className="module-select-intro">
          <div>
            <span className="module-select-eyebrow">HEATSHIELD AI</span>
            <h1>Select Module</h1>
            <p>Choose the operating context. Each module uses the same FortyGuard-first intelligence core, then applies domain-specific decisions and workflows.</p>
          </div>
          <div className="module-select-proof">
            <CheckCircle2 size={18} />
            <span><strong>Shared intelligence core</strong><small>One thermal foundation across every workflow</small></span>
          </div>
        </section>

        <section className="module-card-grid" aria-label="HeatShield modules">
          {primaryModules.map(({ id, title, description, route, artwork, capability }) => (
            <article key={id} className={`module-card module-card--${id}`}>
              <div className="module-card__visual">
                <img className="module-card__artwork" src={artwork} alt="" aria-hidden="true" />
                <span className="module-card__source"><span /> FortyGuard core</span>
              </div>
              <div className="module-card__body">
                <span className="module-card__kicker">MODULE</span>
                <h2>{title}</h2>
                <p>{description}</p>
                <small className="module-card__capability">{capability}</small>
                <Link className="module-card__button" to={route}>
                  Open Module <ArrowRight size={17} />
                </Link>
              </div>
            </article>
          ))}
        </section>

        <section className="module-secondary-grid">
          <Link to="/reports" className="module-secondary-card module-secondary-card--reports">
            <span className="module-secondary-card__icon"><BarChart3 size={28} /></span>
            <span className="module-secondary-card__copy">
              <small>PLATFORM</small>
              <strong>Reports</strong>
              <span>Review and export evidence-backed heat intelligence.</span>
            </span>
            <ArrowRight size={19} />
          </Link>

          <Link to="/settings" className="module-secondary-card module-secondary-card--settings">
            <span className="module-secondary-card__icon"><Settings size={28} /></span>
            <span className="module-secondary-card__copy">
              <small>PLATFORM</small>
              <strong>Settings</strong>
              <span>Manage sites, integrations, workspace and intelligence configuration.</span>
            </span>
            <ArrowRight size={19} />
          </Link>
        </section>

        <section className="module-platform-strip">
          <div className="module-platform-strip__heading">
            <span className="module-select-eyebrow">PLATFORM FOUNDATION</span>
            <h2>One heat intelligence system. Multiple operating contexts.</h2>
          </div>
          <div className="module-platform-strip__grid">
            {platformSignals.map(({ icon: Icon, title, detail }) => (
              <div key={title} className="module-platform-signal">
                <span><Icon size={22} strokeWidth={1.75} /></span>
                <div><strong>{title}</strong><small>{detail}</small></div>
              </div>
            ))}
          </div>
        </section>

        <footer className="module-select-footer">
          <span><Factory size={15} /> HeatShield AI</span>
          <span>FortyGuard-first heat intelligence platform</span>
        </footer>
      </main>
    </div>
  )
}
