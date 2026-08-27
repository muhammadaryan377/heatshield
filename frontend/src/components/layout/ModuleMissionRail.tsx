import { ArrowRight, Bot, CheckCircle2, CircleDot, Repeat2, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { contextualModuleRoute } from '../../lib/moduleContext'
import type { HeatShieldModule } from './AppShell'
import './module-mission-rail.css'

type MissionStep = {
  label: string
  detail: string
  to: string
  matches: string[]
}

type MissionConfig = {
  audience: string
  outcome: string
  steps: MissionStep[]
}

const missions: Record<Exclude<HeatShieldModule, 'global'>, MissionConfig> = {
  workforce: {
    audience: 'Site safety & operations supervisor',
    outcome: 'Put the right worker in the right place or time, then verify the exposure improvement.',
    steps: [
      { label: 'Prepare', detail: 'Site, crew and approved zones', to: '/sites', matches: ['/sites', '/workers/new', '/add-worker'] },
      { label: 'Observe', detail: 'Current site & worker exposure', to: '/workforce', matches: ['/workforce', '/historical-intelligence', '/heat-history'] },
      { label: 'Decide', detail: 'Run domain mission agent', to: '/agent?module=workforce', matches: ['/agent'] },
      { label: 'Approve & verify', detail: 'Worker action + fresh FortyGuard', to: '/plan', matches: ['/plan'] },
    ],
  },
  enterprise: {
    audience: 'Facility, asset & portfolio manager',
    outcome: 'Find the property or asset with the strongest heat exposure and move to a reviewable mitigation decision.',
    steps: [
      { label: 'Prepare', detail: 'Register sites and assets', to: '/enterprise/sites', matches: ['/enterprise/sites', '/enterprise/assets'] },
      { label: 'Observe', detail: 'Measure property exposure', to: '/enterprise/property-exposure', matches: ['/enterprise', '/enterprise/property-exposure'] },
      { label: 'Decide', detail: 'Rank next engineering review', to: '/agent?module=enterprise', matches: ['/agent'] },
      { label: 'Act & document', detail: 'Industrial review + report', to: '/enterprise/industrial', matches: ['/enterprise/industrial', '/enterprise/portfolio-risk', '/enterprise/reports'] },
    ],
  },
  agriculture: {
    audience: 'Farm & field operations manager',
    outcome: 'Identify heat-affected fields, choose safer work or irrigation inspection timing, and keep evidence visible.',
    steps: [
      { label: 'Prepare', detail: 'Farm and field boundaries', to: '/agriculture/fields', matches: ['/agriculture/farms', '/agriculture/fields'] },
      { label: 'Observe', detail: 'Crop and field heat evidence', to: '/agriculture/crop-heat-stress', matches: ['/agriculture', '/agriculture/crop-heat-stress'] },
      { label: 'Decide', detail: 'Rank field operation priority', to: '/agent?module=agriculture', matches: ['/agent'] },
      { label: 'Act & monitor', detail: 'Field work, inspection, alerts', to: '/agriculture/field-work', matches: ['/agriculture/field-work', '/agriculture/irrigation', '/agriculture/alerts'] },
    ],
  },
  urban: {
    audience: 'Urban planner & resilience team',
    outcome: 'Find persistent hotspots, select a defensible intervention, and verify the before/after signal.',
    steps: [
      { label: 'Prepare', detail: 'District boundary', to: '/urban/districts', matches: ['/urban/districts'] },
      { label: 'Observe', detail: 'Heat islands and drivers', to: '/urban/heat-islands', matches: ['/urban', '/urban/heat-islands', '/urban/analysis'] },
      { label: 'Decide', detail: 'Choose evidence-bound next step', to: '/agent?module=urban', matches: ['/agent', '/urban/interventions'] },
      { label: 'Verify', detail: 'Matched Before / After', to: '/urban/before-after', matches: ['/urban/before-after'] },
    ],
  },
}

function pathMatches(pathname: string, matches: string[]) {
  return matches.some((route) => pathname === route || (route !== '/' && pathname.startsWith(`${route}/`)))
}

export function ModuleMissionRail({ module }: { module: HeatShieldModule }) {
  const location = useLocation()
  if (module === 'global') return null

  const mission = missions[module]
  const activeIndex = mission.steps.findIndex((step) => pathMatches(location.pathname, step.matches))
  const routeFor = (to: string) => contextualModuleRoute(to, module, location.search)

  return (
    <section className={`module-mission-rail module-mission-rail--${module}`} aria-label={`${module} operational mission`}>
      <div className="module-mission-rail__summary">
        <span className="module-mission-rail__agent"><Bot size={16} /> HEATSHIELD MISSION</span>
        <strong>{mission.audience}</strong>
        <small>{mission.outcome}</small>
      </div>

      <div className="module-mission-rail__steps">
        {mission.steps.map((step, index) => {
          const complete = activeIndex >= 0 && index < activeIndex
          const active = activeIndex >= 0 && index === activeIndex
          return (
            <Link
              key={`${step.label}-${index}`}
              to={routeFor(step.to)}
              className={`module-mission-step${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className="module-mission-step__icon">
                {complete ? <CheckCircle2 size={16} /> : active ? <CircleDot size={16} /> : <span>{index + 1}</span>}
              </span>
              <span className="module-mission-step__copy">
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              {index === mission.steps.length - 1 ? <Repeat2 size={14} /> : <ArrowRight size={14} />}
            </Link>
          )
        })}
      </div>

      <div className="module-mission-rail__guardrail">
        <ShieldCheck size={15} />
        <span>Evidence first · domain constraints · human review where action matters</span>
      </div>
    </section>
  )
}
