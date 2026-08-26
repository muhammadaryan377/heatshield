import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Factory,
  Layers3,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '../components/ui/BrandLogo'
import '../module-selection.css'
import '../module-selection-artwork.css'
import '../module-selection-agent.css'

const primaryModules = [
  {
    id: 'workforce',
    title: 'Workforce Safety',
    description: 'For site safety supervisors: decide which worker should work where or when under heat, approve the action, then verify the exposure change.',
    route: '/workforce',
    artwork: '/module-artwork/workforce.png',
    capability: 'Workers · Approved Zones · Agent Decisions · Verification',
  },
  {
    id: 'enterprise',
    title: 'Enterprise',
    description: 'For facility and portfolio teams: identify which property or critical asset deserves the next heat-exposure engineering review.',
    route: '/enterprise',
    artwork: '/module-artwork/enterprise.png',
    capability: 'Properties · Assets · Priority · Industrial Review',
  },
  {
    id: 'agriculture',
    title: 'Agriculture',
    description: 'For farm operators: identify the field needing heat attention, choose safer work timing or irrigation-system inspection, and monitor persistence.',
    route: '/agriculture',
    artwork: '/module-artwork/agriculture.png',
    capability: 'Fields · Thermal Screening · Work Timing · Inspection',
  },
  {
    id: 'urban',
    title: 'Urban Intelligence',
    description: 'For resilience teams: rank hotspot candidates, move to a defensible intervention, and verify the post-intervention relative signal.',
    route: '/urban',
    artwork: '/module-artwork/urban.png',
    capability: 'Districts · Hotspots · Interventions · Before / After',
  },
] as const

const platformSignals = [
  {
    icon: ShieldCheck,
    title: 'FortyGuard Evidence Core',
    detail: 'Spatial thermal and temporal evidence stays separate from HeatShield-derived decisions.',
  },
  {
    icon: BrainCircuit,
    title: 'Bounded Agent',
    detail: 'The agent ranks evidence-backed candidates and critiques proposals without inventing measurements.',
  },
  {
    icon: Layers3,
    title: 'Four Domain Toolkits',
    detail: 'The same agent core applies worker, asset, field and urban-planning constraints.',
  },
  {
    icon: LockKeyhole,
    title: 'Human-Gated Action',
    detail: 'Operationally meaningful actions stay reviewable, traceable and verifiable.',
  },
] as const

export function ModuleSelectionPage() {
  return (
    <div className="module-select-page">
      <header className="module-select-header">
        <div className="module-select-header__brand">
          <BrandLogo />
          <span className="module-select-header__descriptor">Agentic Heat Decision Platform</span>
        </div>

        <div className="module-select-header__actions">
          <div className="module-core-status" title="HeatShield is designed around FortyGuard thermal intelligence">
            <span className="module-core-status__dot" />
            <span>
              <small>THERMAL EVIDENCE CORE</small>
              <strong>FortyGuard</strong>
            </span>
          </div>
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
            <h1>Choose the heat mission you need to solve</h1>
            <p>Four operating contexts share one evidence-bound agent: observe real heat, rank valid actions, apply domain constraints, require human review, and verify outcomes where the evidence supports it.</p>
          </div>
          <div className="module-select-proof">
            <CheckCircle2 size={18} />
            <span><strong>One bounded agent core</strong><small>Four domain toolkits · one evidence policy</small></span>
          </div>
        </section>

        <section className="module-card-grid" aria-label="HeatShield modules">
          {primaryModules.map(({ id, title, description, route, artwork, capability }) => (
            <article key={id} className={`module-card module-card--${id}`}>
              <div className="module-card__visual">
                <img className="module-card__artwork" src={artwork} alt={`${title} module`} />
                <span className="module-card__source"><span /> FortyGuard evidence</span>
              </div>
              <div className="module-card__body">
                <span className="module-card__kicker">OPERATING MISSION</span>
                <h2>{title}</h2>
                <p>{description}</p>
                <small className="module-card__capability">{capability}</small>
                <Link className="module-card__button" to={route}>
                  Open Mission <ArrowRight size={17} />
                </Link>
              </div>
            </article>
          ))}
        </section>

        <section className="module-secondary-grid module-secondary-grid--agentic">
          <Link to="/agent" className="module-secondary-card module-secondary-card--agent">
            <span className="module-secondary-card__icon"><Bot size={28} /></span>
            <span className="module-secondary-card__copy">
              <small>SHARED INTELLIGENCE</small>
              <strong>Command Agent</strong>
              <span>Run the same bounded decision loop across Workforce, Enterprise, Agriculture or Urban context.</span>
            </span>
            <ArrowRight size={19} />
          </Link>

          <Link to="/reports" className="module-secondary-card module-secondary-card--reports">
            <span className="module-secondary-card__icon"><BarChart3 size={28} /></span>
            <span className="module-secondary-card__copy">
              <small>PLATFORM</small>
              <strong>Reports</strong>
              <span>Review and export evidence-backed heat intelligence.</span>
            </span>
            <ArrowRight size={19} />
          </Link>

          <Link to="/platform-readiness" className="module-secondary-card module-secondary-card--settings">
            <span className="module-secondary-card__icon"><Activity size={28} /></span>
            <span className="module-secondary-card__copy">
              <small>PLATFORM CONTROL</small>
              <strong>Platform Readiness</strong>
              <span>Check providers, real workspace data and module prerequisites before operational use.</span>
            </span>
            <ArrowRight size={19} />
          </Link>
        </section>

        <section className="module-platform-strip">
          <div className="module-platform-strip__heading">
            <span className="module-select-eyebrow">PLATFORM FOUNDATION</span>
            <h2>Observe → decide → human review → verify.</h2>
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
          <span>FortyGuard-grounded agentic heat decisions</span>
        </footer>
      </main>
    </div>
  )
}
