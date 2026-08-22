import { MoreVertical, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Worker } from '../../types/site'
import { RiskBadge } from '../ui/RiskBadge'

interface WorkerOverviewProps {
  workers: Worker[]
  siteId: string
}

const avatarTones = ['avatar--teal', 'avatar--gold', 'avatar--slate', 'avatar--blue']

export function WorkerOverview({ workers, siteId }: WorkerOverviewProps) {
  const navigate = useNavigate()
  const visibleWorkers = workers.slice(0, 6)
  const addWorker = () => navigate(`/workers/new?site=${encodeURIComponent(siteId)}`)

  return (
    <section className="worker-overview panel">
      <div className="panel-heading">
        <h2>Worker Overview ({workers.length})</h2>
        <button type="button" className="button button--quiet" onClick={addWorker}><UserPlus size={16} /> Add Worker</button>
      </div>

      {!workers.length ? (
        <div className="worker-empty-state">
          <span className="worker-empty-state__icon"><UserPlus size={24} /></span>
          <div>
            <strong>No workers assigned yet</strong>
            <p>Workers only appear here after you add them to this site. HeatShield will never invent worker records.</p>
          </div>
          <button type="button" className="button button--primary" onClick={addWorker}>Add first worker</button>
        </div>
      ) : (
        <>
          <div className="worker-table-wrap">
            <table className="worker-table">
              <thead><tr><th>Worker</th><th>Role</th><th>Location</th><th>Status</th><th>Risk</th><th>Last Check-In</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {visibleWorkers.map((worker, index) => (
                  <tr key={worker.id}>
                    <td><div className="worker-name-cell"><span className={`worker-avatar ${avatarTones[index % avatarTones.length]}`}>{worker.initials}</span><strong>{worker.name}</strong></div></td>
                    <td>{worker.role}</td>
                    <td><span className={`location-dot location-dot--${worker.risk}`} />{worker.location}</td>
                    <td><span className={`status-pill status-pill--${worker.status}`}>{worker.status === 'break' ? 'Break' : 'Active'}</span></td>
                    <td><RiskBadge level={worker.risk} compact /></td>
                    <td>{worker.lastCheckIn}</td>
                    <td><button type="button" className="row-action" aria-label={`Actions for ${worker.name}`}><MoreVertical size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worker-overview__footer">
            <span>Showing {visibleWorkers.length} of {workers.length} workers</span>
            <button type="button" className="text-link" onClick={addWorker}>Add another worker <span>›</span></button>
          </div>
        </>
      )}
    </section>
  )
}
