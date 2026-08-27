import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const ENTERPRISE_HISTORY_MIN = '2019-01-01'

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function lastCompletedDay() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return localDateString(date)
}

function pageTitle(pathname: string) {
  if (pathname === '/') return 'HeatShield · Intelligence Platform'
  if (pathname === '/platform-readiness') return 'Platform Readiness · HeatShield'
  if (pathname === '/agent') return 'Command Agent · HeatShield'
  if (pathname === '/enterprise') return 'Enterprise Overview · HeatShield'
  if (pathname.startsWith('/enterprise/sites')) return 'Enterprise Sites · HeatShield'
  if (pathname.startsWith('/enterprise/property-exposure')) return 'Property Heat Exposure · HeatShield'
  if (pathname.startsWith('/enterprise/assets')) return 'Asset Intelligence · HeatShield'
  if (pathname.startsWith('/enterprise/industrial')) return 'Data Center / Industrial · HeatShield'
  if (pathname.startsWith('/enterprise/portfolio-risk')) return 'Portfolio Risk · HeatShield'
  if (pathname.startsWith('/enterprise/reports')) return 'Heat Risk Reports · HeatShield'
  if (pathname.startsWith('/workforce')) return 'Workforce Safety · HeatShield'
  if (pathname.startsWith('/workers') || pathname.startsWith('/add-worker')) return 'Crew Setup · HeatShield'
  if (pathname.startsWith('/plan')) return 'HeatShield Agent · HeatShield'
  if (pathname === '/sites') return 'Site & Zones · HeatShield'
  if (pathname.startsWith('/heat-history') || pathname.startsWith('/historical-intelligence')) return 'Historical Heat Intelligence · HeatShield'
  if (pathname.startsWith('/agriculture')) return 'Agriculture Intelligence · HeatShield'
  if (pathname.startsWith('/urban')) return 'Urban Intelligence · HeatShield'
  if (pathname.startsWith('/reports')) return 'Reports · HeatShield'
  return 'HeatShield'
}

export function RouteEffects(): null {
  const location = useLocation()

  useEffect(() => {
    document.title = pageTitle(location.pathname)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    if (!location.pathname.startsWith('/enterprise')) return

    const maxDate = lastCompletedDay()
    const normalizeDateInputs = () => {
      document.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach((input) => {
        if (input.min !== ENTERPRISE_HISTORY_MIN) input.min = ENTERPRISE_HISTORY_MIN
        if (input.max !== maxDate) input.max = maxDate
      })
    }

    normalizeDateInputs()
    const observer = new MutationObserver(normalizeDateInputs)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [location.pathname])

  return null
}
