import { Droplets, ShieldCheck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import type { SiteIntelligence } from '../../types/site'

interface NextActionProps {
  data: SiteIntelligence
}

export function NextAction({ data }: NextActionProps) {
  const navigate = useNavigate()
  const [reminderState, setReminderState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const action = data.nextAction

  const sendReminder = async () => {
    setReminderState('sending')
    try {
      await api.sendHydrationReminder(data.site.id)
      setReminderState('sent')
    } catch {
      setReminderState('error')
    }
  }

  if (!action) {
    return (
      <article className="mini-card next-action panel">
        <h3>Next Recommended Action</h3>
        <div className="next-action__body">
          <span className="next-action__icon"><UserPlus size={24} /></span>
          <div>
            <strong>{data.workers.length ? 'Waiting for verified decision inputs' : 'Add workers to this site'}</strong>
            <p>{data.workers.length ? 'Operational actions appear only when HeatShield has enough evidence to justify a worker-level recommendation.' : 'HeatShield creates worker-specific actions only from workers you actually add.'}</p>
          </div>
        </div>
        {!data.workers.length && <button className="button button--outline-teal next-action__button" onClick={() => navigate(`/workers/new?site=${encodeURIComponent(data.site.id)}`)}>Add Worker</button>}
      </article>
    )
  }

  return (
    <article className="mini-card next-action panel">
      <h3>Next Recommended Action</h3>
      <div className="next-action__body">
        <span className="next-action__icon"><ShieldCheck size={24} /></span>
        <div><strong>{action.title}</strong><p>{action.detail}</p></div>
      </div>
      <button className="button button--primary next-action__button" onClick={() => navigate(`/plan?site=${encodeURIComponent(data.site.id)}`)}>
        {action.actionLabel}
      </button>
      <button className="next-action__secondary" type="button" onClick={sendReminder} disabled={reminderState === 'sending' || reminderState === 'sent'}>
        <Droplets size={13} />
        {reminderState === 'sending' ? 'Sending reminder…' : reminderState === 'sent' ? 'Hydration reminder sent' : 'Send hydration reminder'}
      </button>
      {reminderState === 'error' && <span className="next-action__error">Notification provider is not configured yet. The decision plan is still available above.</span>}
    </article>
  )
}
