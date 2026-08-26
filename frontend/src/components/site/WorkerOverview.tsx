import { ArrowRight, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Worker } from '../../types/site'
import { RiskBadge } from '../ui/RiskBadge'

interface WorkerOverviewProps {
  workers: Worker[]
  siteId: string
}

const avatarTones = ['avatar--teal', 'avatar--gold', 'avatar--slate', 'avatar--blue']
const riskRank = { low: 0, medium: 1, high: 2, extreme: 3 } as const

function recommendation(worker: Worker) {
  if (worker.status === 'offsite') return { label: 'Offsite', tone: 'neutral', actionable: false }
  if (worker.status === 'break') return { label: 'Maintain break', tone: 'watch', actionable: false }
  if (worker.risk === 'extreme' || worker.risk === 'high') return { label: 'Review assignment', tone: 'danger', actionable: true }
  if (worker.risk === 'medium') return { label: 'Review in plan', tone: 'watch', actionable: true }
  return { label: 'No change', tone: 'safe', actionable: false }
}

export function WorkerOverview({ workers, siteId }: WorkerOverviewProps) {
  const navigate = useNavigate()
  const orderedWorkers = [...workers].sort((a, b) => {
    const statusRank = (worker: Worker) => worker.status === 'active' ? 2 : worker.status === 'break' ? 1 : 0
    const statusDelta = statusRank(b) - statusRank(a)
    if (statusDelta) return statusDelta
    return riskRank[b.risk] - riskRank[a.risk]
  })
  const visibleWorkers = orderedWorkers.slice(0, 8)
  const addWorker = () => navigate(`/workers/new?site=${encodeURIComponent(siteId)}`)
  const activeWorkers = workers.filter((worker) => worker.status === 'active')
  const elevatedCount = activeWorkers.filter((worker) => worker.risk !== 'low').length
  const breakCount = workers.filter((worker) => worker.status === 'break').length
  const offsiteCount = workers.filter((worker) => worker.status === 'offsite').length

  return (
    <section className="worker-overview worker-overview--command panel">
      <div className="panel-heading worker-overview__heading">
        <div>
          <h2>Worker Exposure Overview ({workers.length})</h2>
          <span>{elevatedCount ? `${elevatedCount} active worker${elevatedCount === 1 ? '' : 's'} need exposure review` : activeWorkers.length ? 'No active worker currently needs an exposure-driven assignment change' : 'No workers are currently marked active'}</span>
        </div>
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
                    <tr key={worker.id} className={worker.status === 'active' && (worker.risk === 'high' || worker.risk === 'extreme') ? 'worker-row--attention' : ''}>
                      <td><div className="worker-name-cell"><span className={`worker-avatar ${avatarTones[index % avatarTones.length]}`}>{worker.initials}</span><span><strong>{worker.name}</strong><small>{worker.role}</small></span></div></td>
                      <td>{worker.task || 'Unassigned'}</td>
                      <td><span className={`location-dot location-dot--${worker.risk}`} />{worker.location}</td>
                      <td><RiskBadge level={worker.risk} compact /></td>
                      <td>{worker.shiftStart && worker.shiftEnd ? `${worker.shiftStart}–${worker.shiftEnd}` : worker.lastCheckIn || '—'}</td>
                      <td>
                        {next.actionable ? (
                          <button type="button" className={`worker-recommendation worker-recommendation--${next.tone}`} onClick={() => navigate(`/plan?site=${encodeURIComponent(siteId)}&worker=${encodeURIComponent(worker.id)}`)}>{next.label}<ArrowRight size={13} /></button>
                        ) : (
                          <span className={`worker-recommendation worker-recommendation--${next.tone}`}>{next.label}</span>
                        )}
                      </td>
                      <td><span className={`status-pill status-pill--${worker.status}`}>{worker.status === 'break' ? 'Break' : worker.status === 'offsite' ? 'Offsite' : 'Active'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="worker-overview__footer">
            <span>Showing {visibleWorkers.length} of {workers.length} · {activeWorkers.length} active{breakCount ? ` · ${breakCount} break` : ''}{offsiteCount ? ` · ${offsiteCount} offsite` : ''}</span>
            {activeWorkers.length > 0 && <button type="button" className="text-link" onClick={() => navigate(`/plan?site=${encodeURIComponent(siteId)}`)}>Review worker plan <span>›</span></button>}
          </div>
        </>
      )}
    </section>
  )
}
