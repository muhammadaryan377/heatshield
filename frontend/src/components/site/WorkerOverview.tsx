import { MoreVertical } from 'lucide-react'
import type { Worker } from '../../types/site'
import { RiskBadge } from '../ui/RiskBadge'

interface WorkerOverviewProps {
  workers: Worker[]
}

const avatarTones = ['avatar--teal', 'avatar--gold', 'avatar--slate', 'avatar--blue']

export function WorkerOverview({ workers }: WorkerOverviewProps) {
  const visibleWorkers = workers.slice(0, 4)
  return (
    <section className="worker-overview panel">
      <div className="panel-heading">
        <h2>Worker Overview ({workers.length})</h2>
        <button type="button" className="text-link">View all workers</button>
      </div>
      <div className="worker-table-wrap">
        <table className="worker-table">
          <thead>
            <tr>
              <th>Worker</th><th>Role</th><th>Location</th><th>Status</th><th>Risk</th><th>Last Check-In</th><th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleWorkers.map((worker, index) => (
              <tr key={worker.id}>
                <td>
                  <div className="worker-name-cell">
                    <span className={`worker-avatar ${avatarTones[index % avatarTones.length]}`}>{worker.initials}</span>
                    <strong>{worker.name}</strong>
                  </div>
                </td>
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
        <button type="button" className="text-link">View all workers <span>›</span></button>
      </div>
    </section>
  )
}
