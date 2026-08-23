import { Building2, Info, MapPinned, Plus, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { SiteMap } from '../components/site/SiteMap'
import { SiteStatusPanel } from '../components/site/SiteStatusPanel'
import { WorkerOverview } from '../components/site/WorkerOverview'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { Site, SiteIntelligence } from '../types/site'
import '../home-command-center.css'

const STORAGE_KEY = 'heatshield:selected-site'

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return error.name === 'AbortError' || message.includes('aborted') || message.includes('aborterror')
  }
  return false
}

export function SiteIntelligencePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [data, setData] = useState<SiteIntelligence | null>(null)
  const [sitesLoading, setSitesLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [createSiteOpen, setCreateSiteOpen] = useState(false)

  const reload = useCallback(() => setRequestKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setSitesLoading(true)
    setError(null)

    api.listSites(controller.signal)
      .then((loadedSites) => {
        if (!active || controller.signal.aborted) return
        setSites(loadedSites)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && loadedSites.some((site) => site.id === id))
        setSelectedSiteId(preferred ?? loadedSites[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err, controller.signal)) return
        setError(err instanceof Error ? err.message : 'Unable to load sites.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setSitesLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // Site changes after initial load are handled by selectSite and mirrored to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSiteId) {
      setData(null)
      setLoading(false)
      return
    }

    localStorage.setItem(STORAGE_KEY, selectedSiteId)
    setSearchParams({ site: selectedSiteId }, { replace: true })

    const controller = new AbortController()
    let active = true

    setLoading(true)
    setError(null)

    api.getSiteIntelligence(selectedSiteId, controller.signal)
      .then((response) => {
        if (!active || controller.signal.aborted) return
        setData(response)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err, controller.signal)) return
        setError(err instanceof Error ? err.message : 'Unable to load site intelligence.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [selectedSiteId, requestKey, setSearchParams])

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setData(null)
  }

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
    setSelectedSiteId(site.id)
    setData(null)
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        observedAt={data?.observedAt}
        onSiteChange={selectSite}
        onCreateSite={() => setCreateSiteOpen(true)}
      />

      <div className="page-content page-content--command-center">
        {sitesLoading && <StatePanel kind="loading" title="Loading HeatShield" detail="Checking your work sites…" />}

        {!sitesLoading && error && !sites.length && (
          <StatePanel kind="error" title="Could not load sites" detail={error} onRetry={() => window.location.reload()} />
        )}

        {!sitesLoading && !sites.length && !error && (
          <section className="first-site-state panel">
            <div className="first-site-state__visual">
              <div className="first-site-state__grid" />
              <span className="first-site-state__pin first-site-state__pin--one"><MapPinned size={22} /></span>
              <span className="first-site-state__pin first-site-state__pin--two"><MapPinned size={18} /></span>
              <div className="first-site-state__outline" />
            </div>
            <div className="first-site-state__content">
              <span className="eyebrow">START WITH REAL SITE DATA</span>
              <h2>Create your first work site</h2>
              <p>Draw the complete work area on Google Maps, then add the people who work there. HeatShield joins worker context to verified environmental evidence instead of inventing operational records.</p>
              <button type="button" className="button button--primary first-site-state__cta" onClick={() => setCreateSiteOpen(true)}><Plus size={18} /> Create Site</button>
              <div className="setup-sequence">
                <div><span><Building2 size={17} /></span><strong>1. Create site</strong><small>Draw the complete work polygon</small></div>
                <div><span><UserPlus size={17} /></span><strong>2. Add workers</strong><small>Assign tasks and positions</small></div>
                <div><span><Info size={17} /></span><strong>3. Decide</strong><small>Turn heat evidence into actions</small></div>
              </div>
            </div>
          </section>
        )}

        {selectedSiteId && loading && !data && <StatePanel kind="loading" title="Loading Site Intelligence" detail="Reading the selected site and requesting verified environmental evidence…" />}
        {selectedSiteId && error && !data && <StatePanel kind="error" title="Site Intelligence unavailable" detail={error} onRetry={reload} />}

        {data && (
          <>
            {error && <div className="inline-warning"><Info size={16} /><span>Latest refresh failed. Showing the last successful site response.</span><button type="button" onClick={reload}>Retry</button></div>}
            <div className="dashboard-grid dashboard-grid--top command-center-grid">
              <SiteMap site={data.site} workers={data.workers} temperatureC={data.conditions?.temperatureC} weatherLabel={data.conditions?.weatherLabel} />
              <SiteStatusPanel data={data} onRefresh={reload} />
            </div>
            <div className="command-center-workers">
              <WorkerOverview workers={data.workers} siteId={data.site.id} />
            </div>
          </>
        )}
      </div>

      <CreateSiteModal open={createSiteOpen} onClose={() => setCreateSiteOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
