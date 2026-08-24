import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Flame,
  Gauge,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  ThermometerSun,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EnterpriseExposureMap, type ExposureMetric } from '../components/enterprise/EnterpriseExposureMap'
import { AppShell } from '../components/layout/AppShell'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { HistoricalHeatBehaviorResponse, HistoricalLayerStatus } from '../types/history'
import type { Site, SiteIntelligence, ThermalMapResponse } from '../types/site'
import '../enterprise-property-exposure.css'

const STORAGE_KEY = 'heatshield:selected-site'
type Granularity = 60 | 80 | 100

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultAnalysisDate() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return localDateString(date)
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function celsiusToFahrenheit(value: number) {
  return value * 9 / 5 + 32
}

function temperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function formatObserved(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function layerLabel(layer: HistoricalLayerStatus['analyticType']) {
  if (layer === 'exceedance') return 'Exceedance'
  if (layer === 'persistence') return 'Persistence'
  return 'Peak time'
}

function analysisSummary(history: HistoricalHeatBehaviorResponse | null) {
  if (!history || history.dataStatus === 'configuration_required' || history.dataStatus === 'unavailable') {
    return {
      title: 'Exposure interpretation pending',
      detail: 'Run a verified FortyGuard daily analysis before HeatShield interprets property exposure.',
      priority: 'Evidence required',
    }
  }

  const exposedCells = history.cells.filter((cell) => (cell.exceedanceHours ?? 0) > 0)
  const share = history.cells.length ? exposedCells.length / history.cells.length : 0
  const maxPersistence = history.maxPersistenceHours ?? 0
  const maxExceedance = history.maxExceedanceHours ?? 0

  if (maxPersistence >= 6 || maxExceedance >= 10) {
    return {
      title: 'Persistent property heat warrants intervention review',
      detail: 'Verified cells show long-duration heat exposure. Prioritize permanent mitigation, cooling-sensitive infrastructure review, and hotspot investigation before relying on short-term operational changes.',
      priority: 'High review priority',
    }
  }
  if (share >= 0.6 || maxPersistence >= 3) {
    return {
      title: 'Heat exposure is distributed across the property',
      detail: 'The daily evidence is not limited to one isolated cell. Review site-wide surfaces and then connect critical assets to the higher-exposure zones.',
      priority: 'Property-wide review',
    }
  }
  if (exposedCells.length) {
    return {
      title: 'Exposure appears localized',
      detail: 'Verified exceedance is concentrated in a subset of spatial cells. Use the map to identify targeted mitigation candidates before expanding intervention scope.',
      priority: 'Target hotspots',
    }
  }
  return {
    title: 'No threshold exceedance returned for this day',
    detail: 'The selected FortyGuard threshold was not exceeded in the returned cells. Continue monitoring or lower the threshold only if your operational standard requires it.',
    priority: 'Monitor',
  }
}

export function EnterprisePropertyExposurePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [intelligence, setIntelligence] = useState<SiteIntelligence | null>(null)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [history, setHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [metric, setMetric] = useState<ExposureMetric>('temperature')
  const [analysisDate, setAnalysisDate] = useState(defaultAnalysisDate)
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [sitesLoading, setSitesLoading] = useState(true)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createSiteOpen, setCreateSiteOpen] = useState(false)
  const requestRef = useRef<AbortController | null>(null)

  const runExposure = useCallback(async (
    siteId: string,
    request: { date: string; thresholdC: number; granularity: Granularity },
  ) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setAnalysisLoading(true)
    setError(null)

    const [intelligenceResult, thermalResult, historyResult] = await Promise.allSettled([
      api.getSiteIntelligence(siteId, controller.signal),
      api.generateThermalMap(siteId, {
        mode: 'site',
        granularityMeters: request.granularity,
      }, controller.signal),
      api.generateHistoricalHeatBehavior(siteId, {
        startDate: request.date,
        endDate: request.date,
        thresholdF: celsiusToFahrenheit(request.thresholdC),
        granularityMeters: request.granularity,
      }, controller.signal),
    ])

    if (controller.signal.aborted) return

    const messages: string[] = []
    if (intelligenceResult.status === 'fulfilled') setIntelligence(intelligenceResult.value)
    else if (!isAbortError(intelligenceResult.reason, controller.signal)) {
      messages.push(intelligenceResult.reason instanceof Error ? intelligenceResult.reason.message : 'Site conditions could not be loaded.')
    }

    if (thermalResult.status === 'fulfilled') {
      setThermal(thermalResult.value)
      if (thermalResult.value.dataStatus !== 'verified' && thermalResult.value.message) messages.push(thermalResult.value.message)
    } else if (!isAbortError(thermalResult.reason, controller.signal)) {
      setThermal(null)
      messages.push(thermalResult.reason instanceof Error ? thermalResult.reason.message : 'Latest FortyGuard temperature layer could not be loaded.')
    }

    if (historyResult.status === 'fulfilled') {
      setHistory(historyResult.value)
      if (historyResult.value.dataStatus === 'configuration_required' || historyResult.value.dataStatus === 'unavailable') {
        if (historyResult.value.message) messages.push(historyResult.value.message)
      }
    } else if (!isAbortError(historyResult.reason, controller.signal)) {
      setHistory(null)
      messages.push(historyResult.reason instanceof Error ? historyResult.reason.message : 'Daily FortyGuard exposure analysis could not be loaded.')
    }

    setError(messages.length ? messages.join(' ') : null)
    setAnalysisLoading(false)
  }, [])

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    setSitesLoading(true)
    setError(null)

    api.listSites(controller.signal)
      .then((loadedSites) => {
        if (controller.signal.aborted) return
        setSites(loadedSites)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && loadedSites.some((site) => site.id === id)) ?? loadedSites[0]?.id ?? null
        setSelectedSiteId(preferred)
        if (preferred) {
          localStorage.setItem(STORAGE_KEY, preferred)
          setSearchParams({ site: preferred }, { replace: true })
          void runExposure(preferred, { date: analysisDate, thresholdC, granularity })
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load enterprise sites.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setSitesLoading(false)
      })

    return () => controller.abort()
    // Initial request uses the default exposure controls; later changes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites])
  const summary = useMemo(() => analysisSummary(history), [history])
  const verifiedLayers = history?.layers.filter((layer) => layer.status === 'verified').length ?? 0
  const exposedCells = history?.cells.filter((cell) => (cell.exceedanceHours ?? 0) > 0).length ?? 0
  const exposedCellShare = history?.cells.length ? Math.round(exposedCells / history.cells.length * 100) : null
  const thermalSpread = thermal?.dataStatus === 'verified' && thermal.maxTemperatureC != null && thermal.minTemperatureC != null
    ? thermal.maxTemperatureC - thermal.minTemperatureC
    : null
  const hotspotDelta = thermal?.dataStatus === 'verified' && thermal.maxTemperatureC != null && thermal.meanTemperatureC != null
    ? thermal.maxTemperatureC - thermal.meanTemperatureC
    : null

  const topCells = useMemo(() => {
    if (!history) return []
    return [...history.cells]
      .filter((cell) => cell.exceedanceHours != null || cell.persistenceHours != null)
      .sort((a, b) => Math.max(b.exceedanceHours ?? 0, b.persistenceHours ?? 0) - Math.max(a.exceedanceHours ?? 0, a.persistenceHours ?? 0))
      .slice(0, 5)
  }, [history])

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setIntelligence(null)
    setThermal(null)
    setHistory(null)
    setMetric('temperature')
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    void runExposure(siteId, { date: analysisDate, thresholdC, granularity })
  }

  const submitAnalysis = (event: FormEvent) => {
    event.preventDefault()
    if (!selectedSiteId) return
    void runExposure(selectedSiteId, { date: analysisDate, thresholdC, granularity })
  }

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
    setCreateSiteOpen(false)
    selectSite(site.id)
  }

  const maxDate = localDateString(new Date())
  const historyReady = history && history.dataStatus !== 'configuration_required' && history.dataStatus !== 'unavailable'

  return (
    <AppShell module="enterprise">
      <header className="enterprise-exposure-topbar">
        <div>
          <h1>Property Heat Exposure</h1>
          <span>Measure where heat occurs, how long it lasts, and when it peaks across a real enterprise property.</span>
        </div>
        <div className="enterprise-exposure-topbar__spacer" />
        <div className="enterprise-exposure-core">
          <span />
          <div><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard spatial evidence</strong></div>
        </div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="enterprise-exposure-page">
        {sitesLoading && <StatePanel kind="loading" title="Loading Property Exposure" detail="Reading enterprise sites and spatial evidence configuration…" />}

        {!sitesLoading && !sites.length && (
          <section className="enterprise-exposure-empty panel">
            <span><Building2 size={28} /></span>
            <div><strong>Property boundary required</strong><p>Add an enterprise site with real polygon geometry before running FortyGuard spatial exposure analysis.</p></div>
            <button type="button" className="button button--primary" onClick={() => setCreateSiteOpen(true)}><Plus size={17} /> Add Site</button>
          </section>
        )}

        {selectedSite && (
          <>
            <section className="enterprise-exposure-controls panel">
              <div className="enterprise-exposure-controls__site">
                <span>PROPERTY</span>
                <label><MapPin size={17} /><select value={selectedSite.id} onChange={(event) => selectSite(event.target.value)}>{sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
                <small>{selectedSite.address}</small>
              </div>

              <form onSubmit={submitAnalysis} className="enterprise-exposure-controls__form">
                <label><span>Completed day</span><div><CalendarDays size={15} /><input type="date" min="2021-01-01" max={maxDate} value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} /></div></label>
                <label><span>Heat threshold</span><div><ThermometerSun size={15} /><input type="number" min="20" max="55" step="0.5" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /><b>°C</b></div></label>
                <label><span>Spatial resolution</span><div><Database size={15} /><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as Granularity)}><option value={60}>60 m · detailed</option><option value={80}>80 m · balanced</option><option value={100}>100 m · efficient</option></select></div></label>
                <button type="submit" className="button button--primary" disabled={analysisLoading}>{analysisLoading ? <RefreshCw className="spin" size={16} /> : <Activity size={16} />}{analysisLoading ? 'Running analysis…' : 'Run Exposure Analysis'}</button>
              </form>
            </section>

            <div className="enterprise-exposure-source-note">
              <ShieldCheck size={15} />
              <span><strong>Evidence separation:</strong> Temperature shows the latest verified FortyGuard TCM spatial layer. Exceedance, persistence and peak-time layers use the selected completed day ({analysisDate}).</span>
            </div>

            {error && <div className="enterprise-exposure-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="enterprise-exposure-kpis" aria-label="Property heat exposure metrics">
              <article><span><ThermometerSun size={17} /> Latest Peak Surface</span><strong>{temperature(thermal?.maxTemperatureC)}</strong><small>{thermal?.dataStatus === 'verified' ? formatObserved(thermal.observedAt) : 'No synthetic temperature shown'}</small></article>
              <article><span><Gauge size={17} /> Latest Thermal Spread</span><strong>{thermalSpread == null ? '—' : `${thermalSpread.toFixed(1)}°C`}</strong><small>{hotspotDelta == null ? 'Needs verified TCM cells' : `Hottest cell +${hotspotDelta.toFixed(1)}°C vs mean`}</small></article>
              <article><span><Flame size={17} /> Mean Exceedance</span><strong>{hours(history?.meanExceedanceHours)}</strong><small>{historyReady ? `Above ${thresholdC.toFixed(1)}°C · ${analysisDate}` : 'Daily layer unavailable'}</small></article>
              <article><span><Clock3 size={17} /> Max Persistence</span><strong>{hours(history?.maxPersistenceHours)}</strong><small>Longest continuous threshold exceedance</small></article>
              <article><span><Clock3 size={17} /> Common Peak Period</span><strong>{history?.commonPeakPeriodLocal ?? history?.commonPeakHourLocal ?? '—'}</strong><small>{historyReady ? history.timezoneName : 'Daily peak timing unavailable'}</small></article>
              <article><span><Database size={17} /> Exposed Cell Share</span><strong>{exposedCellShare == null ? '—' : `${exposedCellShare}%`}</strong><small>{historyReady ? `${exposedCells} of ${history.cells.length} cells above threshold` : 'Needs verified daily cells'}</small></article>
            </section>

            <section className="enterprise-exposure-main-grid">
              <EnterpriseExposureMap site={selectedSite} thermal={thermal} history={history} metric={metric} onMetricChange={setMetric} analysisDate={analysisDate} />

              <aside className="enterprise-exposure-insights panel">
                <div className="enterprise-exposure-insights__head">
                  <div><span className="enterprise-eyebrow">HEATSHIELD INTERPRETATION</span><h2>Decision Context</h2></div>
                  <span className={historyReady ? 'ready' : 'pending'}>{historyReady ? 'Evidence ready' : 'Pending'}</span>
                </div>

                <section className="enterprise-exposure-decision">
                  <span>PROPERTY PRIORITY</span>
                  <strong>{summary.priority}</strong>
                  <h3>{summary.title}</h3>
                  <p>{summary.detail}</p>
                </section>

                <section className="enterprise-exposure-layer-health">
                  <div className="enterprise-exposure-section-title"><strong>Analytic Layer Health</strong><span>{verifiedLayers}/3 daily layers</span></div>
                  {(history?.layers ?? []).map((layer) => (
                    <div key={layer.analyticType}>
                      {layer.status === 'verified' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                      <span><strong>{layerLabel(layer.analyticType)}</strong><small>{layer.status === 'verified' ? `${layer.cellCount} verified cells` : layer.message ?? 'Unavailable'}</small></span>
                      <b className={layer.status}>{layer.status}</b>
                    </div>
                  ))}
                  {!history?.layers.length && <p>Run the daily analysis to inspect provider layer health.</p>}
                </section>

                <section className="enterprise-exposure-provenance">
                  <div className="enterprise-exposure-section-title"><strong>Evidence Provenance</strong><Database size={15} /></div>
                  <div><span>Temperature spatial source</span><strong>{thermal?.dataStatus === 'verified' ? `FortyGuard TCM · ${thermal.tileCount} cells` : 'Unavailable'}</strong></div>
                  <div><span>Daily analysis date</span><strong>{analysisDate}</strong></div>
                  <div><span>Threshold</span><strong>{thresholdC.toFixed(1)}°C / {celsiusToFahrenheit(thresholdC).toFixed(1)}°F</strong></div>
                  <div><span>Resolution</span><strong>{granularity} m</strong></div>
                  <div><span>Provider requests</span><strong>{history?.providerRequestCount ?? '—'}</strong></div>
                  <div><span>Atmospheric context</span><strong>{intelligence?.conditionSourceLabel ?? intelligence?.conditionSource ?? 'Unavailable'}</strong></div>
                </section>
              </aside>
            </section>

            <section className="enterprise-exposure-bottom-grid">
              <article className="enterprise-exposure-table panel">
                <div className="enterprise-exposure-section-heading"><div><span className="enterprise-eyebrow">SPATIAL PRIORITY</span><h2>Highest Exposure Cells</h2></div><span>{history?.cellCount ?? 0} matched daily cells</span></div>
                <div className="enterprise-exposure-table__head"><span>Cell</span><span>Above threshold</span><span>Persistence</span><span>Peak time</span><span>Interpretation</span></div>
                {topCells.map((cell, index) => {
                  const persistence = cell.persistenceHours ?? 0
                  const exceedance = cell.exceedanceHours ?? 0
                  const interpretation = persistence >= 4 ? 'Persistent hotspot' : exceedance >= 4 ? 'Duration hotspot' : exceedance > 0 ? 'Localized exposure' : 'Monitor'
                  return <div className="enterprise-exposure-table__row" key={cell.id}>
                    <span><b>{String(index + 1).padStart(2, '0')}</b><strong>{cell.id}</strong></span>
                    <span>{hours(cell.exceedanceHours)}</span>
                    <span>{hours(cell.persistenceHours)}</span>
                    <span>{cell.peakHourLocal ?? '—'}</span>
                    <span className={`enterprise-exposure-classification enterprise-exposure-classification--${persistence >= 4 ? 'high' : exceedance > 0 ? 'medium' : 'low'}`}>{interpretation}</span>
                  </div>
                })}
                {!topCells.length && <div className="enterprise-exposure-table__empty">No verified daily exposure cells are available for ranking.</div>}
              </article>

              <article className="enterprise-exposure-zones panel">
                <div className="enterprise-exposure-section-heading"><div><span className="enterprise-eyebrow">SITE OPERATING AREAS</span><h2>Zone Exposure</h2></div><MapPin size={18} /></div>
                {history?.zones.length ? history.zones.map((zone) => (
                  <div className="enterprise-exposure-zone" key={zone.zoneId}>
                    <span><strong>{zone.zoneName}</strong><small>{zone.zoneType} · {zone.evidenceStatus} evidence</small></span>
                    <span><small>Exceedance</small><strong>{hours(zone.exceedanceHours)}</strong></span>
                    <span><small>Persistence</small><strong>{hours(zone.persistenceHours)}</strong></span>
                    <span><small>Peak</small><strong>{zone.peakHourLocal ?? '—'}</strong></span>
                  </div>
                )) : <div className="enterprise-exposure-zones__empty"><MapPin size={22} /><strong>No enterprise zones defined yet</strong><span>Property-wide cells are still analyzed. Add approved site zones later to connect exposure evidence to operating areas.</span></div>}
              </article>
            </section>

            <section className="enterprise-exposure-next panel">
              <div><span className="enterprise-eyebrow">TURN EXPOSURE INTO ENTERPRISE DECISIONS</span><h2>What this screen establishes</h2><p>Property Heat Exposure answers where, when and for how long heat is present. The next intelligence layers connect these verified zones to assets, industrial systems and portfolio priorities.</p></div>
              <div>
                <Link to={`/enterprise/assets?site=${encodeURIComponent(selectedSite.id)}`}><Building2 size={18} /><span><strong>Connect Assets</strong><small>Attach critical infrastructure to exposure zones</small></span><ArrowRight size={16} /></Link>
                <Link to={`/enterprise/industrial?site=${encodeURIComponent(selectedSite.id)}`}><Activity size={18} /><span><strong>Industrial Analysis</strong><small>Translate heat evidence into operational context</small></span><ArrowRight size={16} /></Link>
              </div>
            </section>
          </>
        )}
      </main>

      <CreateSiteModal open={createSiteOpen} onClose={() => setCreateSiteOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
