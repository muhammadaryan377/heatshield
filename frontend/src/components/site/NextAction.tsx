import { ShieldCheck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import type { SiteIntelligence } from '../../types/site'

interface NextActionProps {
  data: SiteIntelligence
}

export function NextAction({ data }: NextActionProps) {
  const navigate = useNavigate()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const action = data.nextAction

  const sendReminder = async () => {
    if (!action) return
    setState('sending')
    try {
      await api.sendHydrationReminder(data.site.id)
      setState('sent')
    } catch {
      setState('error')
    }
  }

  if (!action) {
    return (
      <article className="mini-card next-action panel">
        <h3>Next Recommended Action</h3>
        <div className="next-action__body">
          <span className="next-action__icon"><UserPlus size={24} /></span>
          <div>
            <strong>{data.workers.length ? 'Waiting for live conditions' : 'Add workers to this site'}</strong>
            <p>{data.workers.length ? 'Operational actions will appear after verified environmental data is available.' : 'HeatShield creates worker-specific actions only from workers you actually add.'}</p>
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
      <button className="button button--outline-teal next-action__button" onClick={sendReminder} disabled={state === 'sending' || state === 'sent'}>
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Reminder Sent' : action.actionLabel}
      </button>
      {state === 'error' && <span className="next-action__error">Notification provider is not configured yet.</span>}
    </article>
  )
}
