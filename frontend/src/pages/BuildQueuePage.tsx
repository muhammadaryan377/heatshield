import { ArrowLeft, HardHat } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'

const labels: Record<string, string> = {
  '/workers/new': 'Screen 2 — Add Worker',
  '/plan': 'Screen 3 — Generate Plan',
  '/sites': 'Sites',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

export function BuildQueuePage() {
  const location = useLocation()
  const label = labels[location.pathname] ?? 'HeatShield'
  return (
    <AppShell>
      <div className="queued-screen">
        <div className="queued-screen__icon"><HardHat size={32} /></div>
        <p className="queued-screen__eyebrow">Production build sequence</p>
        <h1>{label}</h1>
        <p>This route is intentionally held until Screen 1 is approved and locked. No throwaway UI has been added.</p>
        <Link className="button button--primary" to="/"><ArrowLeft size={17} /> Back to Site Intelligence</Link>
      </div>
    </AppShell>
  )
}
