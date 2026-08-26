import { ArrowRight, Bot, CheckCircle2, CircleDashed, MapPinned, ShieldCheck, UserPlus, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { SiteIntelligence } from '../../types/site'
import '../../supervisor-mission.css'

type MissionState = 'complete' | 'current' | 'pending'

function Step({
  index,
  title,
  detail,
  state,
}: {
  index: number
  title: string
  detail: string
  state: MissionState
}) {
  return (
    <div className={`supervisor-mission__step supervisor-mission__step--${state}`}>
      <span className="supervisor-mission__step-icon">
        {state === 'complete' ? <CheckCircle2 size={18} /> : state === 'current' ? <CircleDashed size={18} /> : <span>{index}</span>}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

export function SupervisorMissionPanel({ data }: { data: SiteIntelligence }) {
  const activeWorkers = data.workers.filter((worker) => worker.status === 'active')
  const planningReadyWorkers = activeWorkers.filter((worker) => Boolean(worker.task?.trim() && worker.coordinate))
  const approvedZones = data.site.zones.filter((zone) => zone.operationalApproved)
  const boundaryReady = data.site.polygon.length >= 3
  const crewReady = activeWorkers.length > 0 && planningReadyWorkers.length === activeWorkers.length
  const zonesReady = approvedZones.length > 0
  const evidenceReady = data.thermalStatus === 'verified' || data.thermalStatus === 'recent_verified'
  const missionReady = boundaryReady && crewReady && zonesReady

  const evidenceLabel = data.thermalStatus === 'verified'
    ? 'Current FortyGuard spatial evidence available'
    : data.thermalStatus === 'recent_verified'
      ? 'Recent completed-hour FortyGuard evidence available'
      : 'Spatial evidence will be checked by the agent'

  const next = !crewReady
    ? {
        to: `/add-worker?site=${encodeURIComponent(data.site.id)}`,
        label: activeWorkers.length ? 'Complete Worker Setup' : 'Add Active Workers',
        detail: activeWorkers.length
          ? `${activeWorkers.length - planningReadyWorkers.length} active worker profile${activeWorkers.length - planningReadyWorkers.length === 1 ? '' : 's'} need task/location context.`
          : 'Add the people whose heat exposure the supervisor needs to manage.',
        icon: UserPlus,
      }
    : !zonesReady
      ? {
          to: `/sites?site=${encodeURIComponent(data.site.id)}`,
          label: 'Approve Work Zones',
          detail: 'Define task-compatible alternatives so the agent never relocates workers to arbitrary locations.',
          icon: MapPinned,
        }
      : {
          to: `/plan?site=${encodeURIComponent(data.site.id)}`,
          label: 'Run HeatShield Agent',
          detail: 'Compare current assignment, better times and approved places, then approve and verify the action.',
          icon: Bot,
        }

  const NextIcon = next.icon

  return (
    <section className="supervisor-mission panel" aria-label="Heat Operations Mission">
      <div className="supervisor-mission__head">
        <div>
          <span className="supervisor-mission__eyebrow">FLAGSHIP WORKFLOW · SITE SAFETY SUPERVISOR</span>
          <h2>Heat Operations Mission</h2>
          <p>
            Decide which worker should work where or when under heat, approve the safest practical action,
            and verify the outcome with fresh FortyGuard evidence.
          </p>
        </div>
        <div className={`supervisor-mission__readiness${missionReady ? ' is-ready' : ''}`}>
          <ShieldCheck size={18} />
          <span>
            <small>MISSION READINESS</small>
            <strong>{missionReady ? 'Ready for agent decision' : 'Setup in progress'}</strong>
          </span>
        </div>
      </div>

      <div className="supervisor-mission__steps">
        <Step
          index={1}
          title="Site boundary"
          detail={boundaryReady ? `${data.site.polygon.length} map vertices define the operating area.` : 'A real polygon boundary is required.'}
          state={boundaryReady ? 'complete' : 'current'}
        />
        <Step
          index={2}
          title="Worker context"
          detail={crewReady ? `${activeWorkers.length} active worker${activeWorkers.length === 1 ? '' : 's'} ready for planning.` : activeWorkers.length ? `${planningReadyWorkers.length}/${activeWorkers.length} active workers have task/location context.` : 'No active workers configured yet.'}
          state={crewReady ? 'complete' : boundaryReady ? 'current' : 'pending'}
        />
        <Step
          index={3}
          title="Approved alternatives"
          detail={zonesReady ? `${approvedZones.length} supervisor-approved zone${approvedZones.length === 1 ? '' : 's'} available.` : 'Approve task-compatible zones for Better Place decisions.'}
          state={zonesReady ? 'complete' : crewReady ? 'current' : 'pending'}
        />
        <Step
          index={4}
          title="Agent → approve → verify"
          detail={missionReady ? 'HeatShield can now generate supervisor-gated actions.' : 'Unlocks when workers and approved alternatives are ready.'}
          state={missionReady ? 'current' : 'pending'}
        />
      </div>

      <div className="supervisor-mission__footer">
        <div className="supervisor-mission__evidence">
          <UsersRound size={16} />
          <span><strong>{activeWorkers.length} active workers</strong><small>{evidenceReady ? evidenceLabel : evidenceLabel}</small></span>
        </div>
        <Link to={next.to} className="supervisor-mission__cta">
          <NextIcon size={17} />
          <span><strong>{next.label}</strong><small>{next.detail}</small></span>
          <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  )
}
