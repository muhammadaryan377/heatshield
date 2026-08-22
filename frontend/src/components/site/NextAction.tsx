import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import type { SiteIntelligence } from '../../types/site'

interface NextActionProps {
  data: SiteIntelligence
}

export function NextAction({ data }: NextActionProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const sendReminder = async () => {
    setState('sending')
    try {
      await api.sendHydrationReminder(data.site.id)
      setState('sent')
    } catch {
      setState('error')
    }
  }

  return (
    <article className="mini-card next-action panel">
      <h3>Next Recommended Action</h3>
      <div className="next-action__body">
        <span className="next-action__icon"><ShieldCheck size={24} /></span>
        <div>
          <strong>{data.nextAction.title}</strong>
          <p>{data.nextAction.detail}</p>
        </div>
      </div>
      <button className="button button--outline-teal next-action__button" onClick={sendReminder} disabled={state === 'sending' || state === 'sent'}>
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Reminder Sent' : data.nextAction.actionLabel}
      </button>
      {state === 'error' && <span className="next-action__error">Could not send. Check backend configuration.</span>}
      <button type="button" className="text-link mini-card__link">View all actions <span>›</span></button>
    </article>
  )
}
