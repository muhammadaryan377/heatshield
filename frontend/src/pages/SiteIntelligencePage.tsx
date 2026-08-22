import { Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { ExposureHotspots } from '../components/site/ExposureHotspots'
import { LiveConditions } from '../components/site/LiveConditions'
import { NextAction } from '../components/site/NextAction'
import { SiteMap } from '../components/site/SiteMap'
import { SiteStatusPanel } from '../components/site/SiteStatusPanel'
import { WorkerOverview } from '../components/site/WorkerOverview'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { SiteIntelligence } from '../types/site'

const DEFAULT_SITE_ID = 'site-a'

export function SiteIntelligencePage() {
  const [data, setData] = useState<SiteIntelligence | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [requestKey, setRequestKey] = useState(0)

  const reload = useCallback(() => setRequestKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.getSiteIntelligence(DEFAULT_SITE_ID, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Unable to load site intelligence.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [requestKey])

  const observedAt = data?.observedAt ?? new Date().toISOString()
  const siteName = data?.site.name ?? 'Site A - Construction Yard'

  return (
    <AppShell>
      <Topbar siteName={siteName} observedAt={observedAt} />
      <div className="page-content">
        {loading && !data && (
          <StatePanel kind="loading" title="Loading Site Intelligence" detail="Collecting site, worker and environmental context…" />
        )}
        {error && !data && (
          <StatePanel kind="error" title="Site Intelligence unavailable" detail={error} onRetry={reload} />
        )}
        {data && (
          <>
            {error && (
              <div className="inline-warning">
                <Info size={16} />
                <span>Latest refresh failed. Showing the most recent successful observation.</span>
                <button type="button" onClick={reload}>Retry</button>
              </div>
            )}
            <div className="dashboard-grid dashboard-grid--top">
              <SiteMap
                site={data.site}
                workers={data.workers}
                temperatureC={data.conditions.temperatureC}
                weatherLabel={data.conditions.weatherLabel}
              />
              <SiteStatusPanel data={data} />
            </div>

            <div className="dashboard-grid dashboard-grid--bottom">
              <WorkerOverview workers={data.workers} />
              <div className="supporting-grid">
                <LiveConditions data={data} />
                <ExposureHotspots hotspots={data.hotspots} />
                <NextAction data={data} />
              </div>
            </div>

            <div className="recommendation-footnote panel">
              <span><Info size={15} /> Recommendations update automatically as conditions change.</span>
              <button type="button" className="text-link">How it works <span>?</span></button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
