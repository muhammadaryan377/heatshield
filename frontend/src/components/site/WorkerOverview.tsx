import { ArrowRight, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Worker } from '../../types/site'
import { RiskBadge } from '../ui/RiskBadge'

interface WorkerOverviewProps {
  workers: Worker[]
  siteId: string
}

const avatarTones = ['avatar--teal', 'avatar--gold', 'avatar--slate', 'avatar--blue']

function recommendation(worker: Worker) {
  if (worker.status === 'offsite') return { label: 'Offsite', tone: 'neutral' }
  if (worker.status === 'break') return { label: 'Maintain break', tone: 'watch' }
  if (worker.risk === 'extreme' || worker.risk === 'high') return { label: 'Reassign / reduce exposure', tone: 'danger' }
  if (worker.risk === 'medium') return { label: 'Review in plan', tone: 'watch' }
  return { label: 'Continue', tone: 'safe' }
}

export function WorkerOverview({ workers, siteId }: WorkerOverviewProps) {
  const navigate = useNavigate()
  const visibleWorkers = workers.slice(0, 8)
  const addWorker = () => navigate(`/workers/new?site=${encodeURIComponent(siteId)}`)
  const elevatedCount = workers.filter((worker) => worker.status !== 'offsite' && worker.risk !== 'low').length

  return (
    <section className="worker-overview worker-overview--command panel">
      <div className="panel-heading worker-overview__heading">
        <div><h2>Worker Exposure Overview ({workers.length})</h2><span>{elevatedCount ? `${elevatedCount} worker${elevatedCount === 1 ? '' : 's'} need exposure review` : 'No assigned worker currently needs heat intervention'}</span></div>
        <button type="button" className="button button--quiet" onClick={addWorker}><UserPlus size={16} /> Add Worker</button>
      </div>

      {!workers.length ? (
        <div className="worker-empty-state">
          <span className="worker-empty-state__icon"><UserPlus size={24} /></span>
          <div><strong>No workers assigned yet</strong><p>Add real workers and positions so HeatShield can join operational context to verified heat evidence.</p></div>
          <button type="button" className="button button--primary" onClick={addWorker}>Add first worker</button>
        </div>
      ) : (
        <>
          <div className="worker-table-wrap">
            <table className="worker-table worker-table--command">
              <thead><tr><th>Worker</th><th>Task</th><th>Current Zone</th><th>Heat Exposure</th><th>Shift / Check-in</th><th>Recommendation</th><th>Status</th></tr></thead>
              <tbody>
                {visibleWorkers.map((worker, index) => {
                  const next = recommendation(worker)
                  return (
                    <tr key={worker.id} className={worker.risk === 'high' || worker.risk === 'extreme' ? 'worker-row--attention' : ''}>
                      <td><div className="worker-name-cell"><span className={`worker-avatar ${avatarTones[index % avatarTones.length]}`}>{worker.initials}</span><span><strong>{worker.name}</strong><small>{worker.role}</small></span></div></td>
                      <td>{worker.task || 'Unassigned'}</td>
                      <td><span className={`location-dot location-dot--${worker.risk}`} />{worker.location}</td>
                      <td><RiskBadge level={worker.risk} compact /></td>
                      <td>{worker.shiftStart && worker.shiftEnd ? `${worker.shiftStart}–${worker.shiftEnd}` : worker.lastCheckIn || '—'}</td>
                      <td><button type="button" className={`worker-recommendation worker-recommendation--${next.tone}`} onClick={() => navigate(`/plan?site=${encodeURIComponent(siteId)}`)}>{next.label}{next.tone !== 'neutral' && <ArrowRight size={13} />}</button></td>
                      <td><span className={`status-pill status-pill--${worker.status}`}>{worker.status === 'break' ? 'Break' : worker.status === 'offsite' ? 'Offsite' : 'Active'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="worker-overview__footer">
            <span>Showing {visibleWorkers.length} of {workers.length} workers</span>
            <button type="button" className="text-link" onClick={() => navigate(`/plan?site=${encodeURIComponent(siteId)}`)}>Review worker plan <span>›</span></button>
          </div>
        </>
      )}
    </section>
  )
}
