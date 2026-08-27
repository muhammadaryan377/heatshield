import { ArrowLeft, Home } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

type RecoveryRoute = {
  label: string
  to: string
  title: string
}

function recoveryRoute(pathname: string): RecoveryRoute {
  if (pathname.startsWith('/enterprise')) return { label: 'Enterprise Overview', to: '/enterprise', title: 'Enterprise' }
  if (pathname.startsWith('/agriculture')) return { label: 'Agriculture Overview', to: '/agriculture', title: 'Agriculture' }
  if (pathname.startsWith('/urban')) return { label: 'Urban Overview', to: '/urban', title: 'Urban Intelligence' }
  if (pathname.startsWith('/workforce') || pathname.startsWith('/workers') || pathname.startsWith('/plan') || pathname.startsWith('/sites') || pathname.startsWith('/historical') || pathname.startsWith('/heat-history')) {
    return { label: 'Workforce Operations', to: '/workforce', title: 'Workforce Safety' }
  }
  return { label: 'Module Selector', to: '/', title: 'HeatShield' }
}

export function NotFoundPage() {
  const location = useLocation()
  const recovery = recoveryRoute(location.pathname)

  return (
    <main className="not-found-page">
      <section className="not-found-page__card">
        <span className="not-found-page__eyebrow">{recovery.title.toUpperCase()}</span>
        <strong className="not-found-page__code">404</strong>
        <h1>That workspace route does not exist</h1>
        <p>Return to the relevant HeatShield workspace or choose another module. No saved site, worker, asset, field or intervention data has been changed.</p>
        <div>
          <Link to="/" className="button button--secondary"><ArrowLeft size={16} /> All Modules</Link>
          <Link to={recovery.to} className="button button--primary"><Home size={16} /> {recovery.label}</Link>
        </div>
      </section>
    </main>
  )
}
