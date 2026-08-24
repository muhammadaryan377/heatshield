import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

function pageTitle(pathname: string) {
  if (pathname === '/') return 'HeatShield · Intelligence Platform'
  if (pathname === '/enterprise') return 'Enterprise Overview · HeatShield'
  if (pathname.startsWith('/enterprise/sites')) return 'Enterprise Sites · HeatShield'
  if (pathname.startsWith('/enterprise/property-exposure')) return 'Property Heat Exposure · HeatShield'
  if (pathname.startsWith('/enterprise/assets')) return 'Asset Intelligence · HeatShield'
  if (pathname.startsWith('/enterprise/industrial')) return 'Data Center / Industrial · HeatShield'
  if (pathname.startsWith('/enterprise/portfolio-risk')) return 'Portfolio Risk · HeatShield'
  if (pathname.startsWith('/enterprise/reports')) return 'Heat Risk Reports · HeatShield'
  if (pathname.startsWith('/workforce')) return 'Workforce Safety · HeatShield'
  if (pathname.startsWith('/workers')) return 'Workers · HeatShield'
  if (pathname.startsWith('/plan')) return 'Operational Plan · HeatShield'
  if (pathname.startsWith('/heat-history')) return 'Historical Heat Intelligence · HeatShield'
  if (pathname.startsWith('/agriculture')) return 'Agriculture Intelligence · HeatShield'
  if (pathname.startsWith('/urban')) return 'Urban Intelligence · HeatShield'
  if (pathname.startsWith('/reports')) return 'Reports · HeatShield'
  if (pathname.startsWith('/settings')) return 'Settings · HeatShield'
  return 'HeatShield'
}

export function RouteEffects() {
  const location = useLocation()

  useEffect(() => {
    document.title = pageTitle(location.pathname)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  return null
}
