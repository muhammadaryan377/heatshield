import {
  AlertTriangle,
  Archive,
  Bot,
  CheckCircle2,
  Clock3,
  CloudSun,
  Database,
  Download,
  Flame,
  Layers3,
  LoaderCircle,
  MapPinned,
  Microscope,
  RefreshCw,
  Satellite,
  ShieldCheck,
  Sparkles,
  Sun,
  ThermometerSun,
  Wind,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HistoricalHeatMap } from '../components/history/HistoricalHeatMap'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api } from '../lib/api'
import type { FortyGuardAdvancedSnapshot, FortyGuardAnalysis, FortyGuardHeatIntelligenceStatus, FortyGuardHeatIntelligenceSubmission } from '../types/fortyguard-advanced'
import type { HistoricalHeatBehaviorResponse, HistoricalZoneSample } from '../types/history'
import type { Site } from '../types/site'
import type { UrbanMorphologyResponse } from '../types/urban'

const STORAGE_KEY = 'heatshield:selected-site'
const ARCHIVE_START = '2019-01-01'
const ALL_ANALYSES: FortyGuardAnalysis[] = ['geographic', 'environmental', 'urban', 'events', 'anthropogenic']
type Period = 7 | 30 | 'custom'
type MapMetric = 'temperature' | 'exceedance' | 'persistence' | 'peak'

function dateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function latestCompletedDate() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return dateOnly(date)
}

function rangeFor(days: number) {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  return { startDate: dateOnly(start), endDate: dateOnly(end) }
}

function celsius(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function topZone(zones: HistoricalZoneSample[], key: 'temperatureC' | 'exceedanceHours' | 'persistenceHours') {
  return [...zones]
    .filter((zone) => zone[key] != null)
    .sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity))[0] ?? null
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function segmentLeaders(segments: Record<string, number>) {
  return Object.entries(segments)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
}

export function SiteHeatIntelligencePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? localStorage.getItem(STORAGE_KEY) ?? '')
  const [period, setPeriod] = useState<Period>(30)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [metric, setMetric] = useState<MapMetric>('temperature')
  const [history, setHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [snapshot, setSnapshot] = useState<FortyGuardAdvancedSnapshot | null>(null)
  const [morphology, setMorphology] = useState<UrbanMorphologyResponse | null>(null)
  const [deepSubmission, setDeepSubmission] = useState<FortyGuardHeatIntelligenceSubmission | null>(null)
  const [deepStatus, setDeepStatus] = useState<FortyGuardHeatIntelligenceStatus | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingEnvironment, setLoadingEnvironment] = useState(false)
  const [loadingMorphology, setLoadingMorphology] = useState(false)
  const [loadingDeep, setLoadingDeep] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoRunRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        setSiteId((current) => loaded.some((site) => site.id === current) ? current : loaded[0]?.id ?? '')
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
  }, [])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const completedMax = latestCompletedDate()

  const runHistorical = async (override?: { startDate: string; endDate: string }) => {
    if (!siteId) return
    let range: { startDate: string; endDate: string }
    if (override) {
      range = override
    } else if (period === 'custom') {
      if (!customStart || !customEnd) {
        setError('Choose both dates for a custom historical window.')
        return
      }
      if (customStart < ARCHIVE_START || customEnd > completedMax || customStart > customEnd) {
        setError('Historical range must stay between Jan 1, 2019 and the latest completed day.')
        return
      }
      range = { startDate: customStart, endDate: customEnd }
    } else {
      range = rangeFor(period)
    }

    setLoadingHistory(true)
    setError(null)
    setMetric('temperature')
    try {
      const response = await api.generateHistoricalHeatBehavior(siteId, {
        ...range,
        thresholdF: thresholdC * 9 / 5 + 32,
        granularityMeters: granularity,
      })
      setHistory(response)
      setSnapshot(null)
      setMorphology(null)
      setDeepSubmission(null)
      setDeepStatus(null)
      if (response.dataStatus === 'unavailable' || response.dataStatus === 'configuration_required') {
        setError(response.message ?? 'FortyGuard historical evidence is unavailable for this request.')
      }
    } catch (err) {
      setHistory(null)
      setError(err instanceof Error ? err.message : 'Could not build the site heat signature.')
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    if (!siteId) return
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    setHistory(null)
    setSnapshot(null)
    setMorphology(null)
    setDeepSubmission(null)
    setDeepStatus(null)
    setError(null)
    setPeriod(30)
    setMetric('temperature')

    if (autoRunRef.current === siteId) return
    autoRunRef.current = siteId
    const range = rangeFor(30)
    void runHistorical(range)
    // runHistorical intentionally uses the selected site state set above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, setSearchParams])

  useEffect(() => {
    if (!deepSubmission || deepStatus?.ready || deepStatus?.status === 'failed') return
    const controller = new AbortController()
    const timer = window.setInterval(() => {
      api.getFortyGuardHeatIntelligenceStatus(deepSubmission.activityId, controller.signal)
        .then((status) => setDeepStatus(status))
        .catch(() => undefined)
    }, 3000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [deepStatus?.ready, deepStatus?.status, deepSubmission])

  const hottestZone = useMemo(() => history ? topZone(history.zones, 'temperatureC') : null, [history])
  const recurringZone = useMemo(() => history ? topZone(history.zones, 'exceedanceHours') : null, [history])
  const persistentZone = useMemo(() => history ? topZone(history.zones, 'persistenceHours') : null, [history])
  const spread = history?.maxTemperatureC != null && history.minTemperatureC != null ? history.maxTemperatureC - history.minTemperatureC : null
  const verifiedLayers = history?.layers.filter((layer) => layer.status === 'verified').length ?? 0

  const loadEnvironment = async () => {
    if (!siteId || !history) return
    setLoadingEnvironment(true)
    setError(null)
    try {
      const response = await api.generateFortyGuardAdvancedSnapshot(siteId, {
        date: history.endDate,
        time: '14:00',
        granularityMeters: granularity,
      })
      setSnapshot(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Full environmental context is unavailable.')
    } finally {
      setLoadingEnvironment(false)
    }
  }

  const loadMorphology = async () => {
    if (!siteId || !selectedSite || !history) return
    setLoadingMorphology(true)
    setError(null)
    try {
      const response = await api.generateUrbanMorphology(siteId, {
        latitude: selectedSite.center.lat,
        longitude: selectedSite.center.lng,
        observedAt: `${history.endDate}T14:00:00`,
        granularityMeters: granularity,
        includeStreetView: true,
      })
      setMorphology(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Satellite / street physical context is unavailable.')
    } finally {
      setLoadingMorphology(false)
    }
  }

  const runDeepIntelligence = async () => {
    if (!siteId || !history) return
    setLoadingDeep(true)
    setError(null)
    try {
      const response = await api.submitFortyGuardHeatIntelligence(siteId, {
        date: history.endDate,
        time: '14:00',
        granularityMeters: granularity,
        analysis: ALL_ANALYSES,
      })
      setDeepSubmission(response)
      setDeepStatus({ activityId: response.activityId, status: 'processing', ready: false, message: response.message })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FortyGuard Heat Intelligence could not start.')
    } finally {
      setLoadingDeep(false)
    }
  }

  const downloadDeepReport = async () => {
    if (!deepSubmission) return
    setError(null)
    try {
      const blob = await api.downloadFortyGuardHeatIntelligence(deepSubmission.activityId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${selectedSite?.name ?? 'site'}-fortyguard-heat-intelligence.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The provider report could not be downloaded.')
    }
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        onSiteChange={setSiteId}
        pageTitle="Site Heat Intelligence"
        pageSubtitle="A spatial heat signature built from FortyGuard temperature, peak time, exceedance, persistence, environmental and physical context."
        showAddSite={false}
        showObservation={false}
        showPlanButton={false}
      />

      <main className="wf-final-page wf-history-page">
        {loadingSites ? (
          <section className="wf-state panel"><LoaderCircle className="wf-spin" size={24} /><div><strong>Loading sites</strong><p>Preparing historical spatial intelligence.</p></div></section>
        ) : !sites.length ? (
          <section className="wf-state panel"><MapPinned size={26} /><div><strong>Create a site first</strong><p>FortyGuard historical analysis needs a saved site polygon.</p></div></section>
        ) : selectedSite ? (
          <>
            <section className="wf-history-command panel">
              <div>
                <span className="wf-eyebrow"><Archive size={14} /> FORTYGUARD ARCHIVE · 2019 → PRESENT</span>
                <h2>How does {selectedSite.name} actually behave under heat?</h2>
                <p>The default 30-day heat signature loads automatically. Change the window only when you need a different comparison; advanced provider controls stay secondary.</p>
              </div>
              <div className="wf-history-controls">
                <div className="wf-segmented">
                  <button className={period === 7 ? 'active' : ''} type="button" onClick={() => { setPeriod(7); setHistory(null) }}>7 days</button>
                  <button className={period === 30 ? 'active' : ''} type="button" onClick={() => { setPeriod(30); setHistory(null) }}>30 days</button>
                  <button className={period === 'custom' ? 'active' : ''} type="button" onClick={() => { setPeriod('custom'); setHistory(null) }}>Custom</button>
                </div>
                {period === 'custom' && <div className="wf-custom-range"><input type="date" min={ARCHIVE_START} max={completedMax} value={customStart} onChange={(event) => setCustomStart(event.target.value)} /><span>→</span><input type="date" min={ARCHIVE_START} max={completedMax} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></div>}
                <details className="wf-advanced-controls">
                  <summary>Advanced</summary>
                  <label>Threshold <input type="number" min={-29} max={71} step={0.5} value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /> °C</label>
                  <label>Resolution <select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as 60 | 80 | 100)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m · credit-aware</option></select></label>
                </details>
                <button className="button button--primary" type="button" disabled={loadingHistory} onClick={() => void runHistorical()}>{loadingHistory ? <LoaderCircle className="wf-spin" size={16} /> : <RefreshCw size={16} />} {loadingHistory ? 'Building signature…' : 'Refresh Heat Signature'}</button>
              </div>
            </section>

            {loadingHistory && !history && (
              <section className="wf-history-loading panel"><div className="wf-agent-scan__pulse"><Layers3 size={21} /></div><div><strong>Building four-layer site heat signature</strong><p>Temperature → peak time → exceedance → persistence. Shared spatial cells are joined to your saved operational zones.</p></div></section>
            )}

            {history && history.dataStatus !== 'unavailable' && history.dataStatus !== 'configuration_required' && (
              <>
                <section className="wf-history-summary panel">
                  <article><span>Recurring hotspot</span><strong>{recurringZone?.zoneName ?? hottestZone?.zoneName ?? 'Spatial cells'}</strong><small>{recurringZone ? `${hours(recurringZone.exceedanceHours)} accumulated exceedance` : 'Inspect the map for hottest cells'}</small></article>
                  <article><span>Typical peak</span><strong>{history.commonPeakPeriodLocal ?? history.commonPeakHourLocal ?? '—'}</strong><small>Dominant local peak from Time of Measure</small></article>
                  <article><span>Heat persistence</span><strong>{hours(history.maxPersistenceHours)}</strong><small>{persistentZone?.zoneName ?? 'Strongest matched cell'}</small></article>
                  <article><span>Spatial contrast</span><strong>{spread == null ? '—' : `${spread.toFixed(1)}°C`}</strong><small>{celsius(history.minTemperatureC)} → {celsius(history.maxTemperatureC)}</small></article>
                </section>

                <div className="wf-history-hero-grid">
                  <HistoricalHeatMap site={selectedSite} result={history} metric={metric} onMetricChange={setMetric} />
                  <aside className="wf-heat-signature panel">
                    <span className="wf-eyebrow"><Sparkles size={14} /> HEATSHIELD INTERPRETATION</span>
                    <h2>Site Heat Signature</h2>
                    <div className="wf-signature-list">
                      <article><Flame size={17} /><div><span>Most repeated heat burden</span><strong>{recurringZone?.zoneName ?? 'Inspect spatial layer'}</strong><small>{recurringZone ? `${hours(recurringZone.exceedanceHours)} above ${history.thresholdC.toFixed(1)}°C` : 'No named zone matched enough evidence'}</small></div></article>
                      <article><Clock3 size={17} /><div><span>Recurring peak window</span><strong>{history.commonPeakPeriodLocal ?? 'Not resolved'}</strong><small>Historical context, not a guarantee for today</small></div></article>
                      <article><ThermometerSun size={17} /><div><span>Hottest matched evidence</span><strong>{celsius(history.maxTemperatureC)}</strong><small>Mean {celsius(history.meanTemperatureC)} across matched cells</small></div></article>
                      <article><Database size={17} /><div><span>Evidence depth</span><strong>{verifiedLayers}/4 thermal analytics verified</strong><small>{history.cellCount} historical cells · {history.providerRequestCount} provider jobs</small></div></article>
                    </div>
                    <div className="wf-operational-meaning">
                      <span>OPERATIONAL MEANING</span>
                      <p>{recurringZone && history.commonPeakPeriodLocal
                        ? `${recurringZone.zoneName} repeatedly carries the strongest named-zone threshold burden, with heat most often peaking ${history.commonPeakPeriodLocal}. Treat that window as a planning constraint when a task-compatible alternative exists.`
                        : history.commonPeakPeriodLocal
                          ? `Heat most often peaks ${history.commonPeakPeriodLocal}. Use this recurring pattern to challenge high-intensity task timing, while today's Operations screen still verifies current conditions.`
                          : 'The historical map is evidence-first. HeatShield will not invent a recurring operational rule when the returned layers are incomplete.'}</p>
                      <button className="button button--primary" type="button" onClick={() => navigate(`/workforce/operations?site=${encodeURIComponent(siteId)}`)}>Use in Operations <Sparkles size={15} /></button>
                    </div>
                  </aside>
                </div>

                <section className="wf-intelligence-orchestrator panel">
                  <div className="wf-section-head">
                    <div><span className="wf-eyebrow"><Bot size={14} /> FORTYGUARD INTELLIGENCE ORCHESTRATOR</span><h2>Go beyond the four thermal layers when the decision needs it</h2><p>These are deliberate on-demand calls so Premium evidence is not repeatedly spent on every screen load.</p></div>
                    <span className="wf-credit-aware"><ShieldCheck size={14} /> credit-aware</span>
                  </div>

                  <div className="wf-intelligence-actions">
                    <article>
                      <div className="wf-intelligence-actions__icon"><CloudSun size={19} /></div>
                      <div><strong>Environmental context</strong><p>Heat index, apparent temperature, wet bulb, humidity, AQI/pollutants, precipitation, cloud and solar irradiance.</p></div>
                      <button className="button button--secondary" type="button" disabled={loadingEnvironment} onClick={() => void loadEnvironment()}>{loadingEnvironment ? <LoaderCircle className="wf-spin" size={15} /> : <Wind size={15} />} {snapshot ? 'Refresh' : 'Load environment'}</button>
                    </article>
                    <article>
                      <div className="wf-intelligence-actions__icon"><Satellite size={19} /></div>
                      <div><strong>Physical site context</strong><p>FortyGuard satellite + street segmentation to describe the physical context around the selected site center.</p></div>
                      <button className="button button--secondary" type="button" disabled={loadingMorphology} onClick={() => void loadMorphology()}>{loadingMorphology ? <LoaderCircle className="wf-spin" size={15} /> : <Satellite size={15} />} {morphology ? 'Refresh' : 'Analyze surfaces'}</button>
                    </article>
                    <article>
                      <div className="wf-intelligence-actions__icon"><Microscope size={19} /></div>
                      <div><strong>Deep Heat Intelligence</strong><p>Geographic, environmental, urban, events and anthropogenic analysis in the provider-generated report.</p></div>
                      {deepStatus?.ready ? <button className="button button--secondary" type="button" onClick={() => void downloadDeepReport()}><Download size={15} /> Download report</button> : <button className="button button--secondary" type="button" disabled={loadingDeep || deepStatus?.status === 'processing'} onClick={() => void runDeepIntelligence()}>{loadingDeep || deepStatus?.status === 'processing' ? <LoaderCircle className="wf-spin" size={15} /> : <Microscope size={15} />} {deepStatus?.status === 'processing' ? 'Provider processing…' : 'Run deep intelligence'}</button>}
                    </article>
                  </div>
                </section>

                {(snapshot || morphology || deepSubmission) && (
                  <section className="wf-context-evidence panel">
                    <div className="wf-section-head"><div><span className="wf-eyebrow">CONTEXTUAL EVIDENCE</span><h2>What else does the provider say about this site?</h2></div><small>Context is kept separate from HeatShield-derived operational meaning</small></div>
                    <div className="wf-context-evidence__grid">
                      <article className={!snapshot ? 'muted' : ''}>
                        <span><CloudSun size={16} /> Environment</span>
                        {snapshot ? <><strong>{celsius(snapshot.environment.heatIndexC)} heat index · {snapshot.environment.relativeHumidityPercent?.toFixed(0) ?? '—'}% RH</strong><p>Wet bulb {celsius(snapshot.environment.wetBulbTemperatureC)} · apparent {celsius(snapshot.environment.apparentTemperatureC)} · AQI {snapshot.environment.airQuality.aqiUs ?? '—'} · GHI {snapshot.environment.solar.ghiWm2?.toFixed(0) ?? '—'} W/m²</p><small>{snapshot.environment.availableMetricCount} environmental metrics available</small></> : <p>Load on demand when atmospheric context can change the operational interpretation.</p>}
                      </article>
                      <article className={!morphology ? 'muted' : ''}>
                        <span><Satellite size={16} /> Physical context</span>
                        {morphology ? <><strong>{morphology.satellite.status === 'verified' ? 'Satellite verified' : 'Satellite unavailable'} · {morphology.streetView.status === 'verified' ? 'Street verified' : 'Street unavailable'}</strong><p>{morphology.dominantClasses.length ? `Dominant classes: ${morphology.dominantClasses.slice(0, 4).join(', ')}` : 'No dominant classes returned.'}</p><small>{morphology.providerRequestCount} segmentation job{morphology.providerRequestCount === 1 ? '' : 's'} · context only, not causal proof</small></> : <p>Use Premium segmentation only when you need physical context for a recurring hotspot.</p>}
                      </article>
                      <article className={!deepSubmission ? 'muted' : ''}>
                        <span><Microscope size={16} /> Deep intelligence</span>
                        {deepSubmission ? <><strong>{deepStatus?.ready ? 'Provider report ready' : deepStatus?.status === 'failed' ? 'Provider report failed' : 'Provider report processing'}</strong><p>Geographic · Environmental · Urban · Events · Anthropogenic</p><small>Activity {deepSubmission.activityId}</small></> : <p>Five-category provider analysis remains optional and auditable.</p>}
                      </article>
                    </div>

                    {morphology && (morphology.satellite.status === 'verified' || morphology.streetView.status === 'verified') && (
                      <div className="wf-segmentation-summary">
                        {morphology.satellite.status === 'verified' && <article><span>Satellite coverage leaders</span>{segmentLeaders(morphology.satellite.segments).map(([name, value]) => <div key={name}><strong>{name}</strong><b>{value.toFixed(1)}%</b></div>)}</article>}
                        {morphology.streetView.status === 'verified' && <article><span>Street-view coverage leaders</span>{segmentLeaders(morphology.streetView.segments).map(([name, value]) => <div key={name}><strong>{name}</strong><b>{value.toFixed(1)}%</b></div>)}</article>}
                      </div>
                    )}
                  </section>
                )}

                <section className="wf-provider-trace panel">
                  <div><span className="wf-eyebrow"><ShieldCheck size={14} /> PROVIDER TRACE</span><h2>FortyGuard features used in this site analysis</h2></div>
                  <div className="wf-provider-trace__grid">
                    {history.layers.map((layer) => <span key={layer.analyticType} className={layer.status === 'verified' ? 'verified' : 'unavailable'}>{layer.status === 'verified' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{layer.analyticType === 'tcm' ? 'Temperature (TCM)' : layer.analyticType === 'time_of_measure' ? 'Time of Measure' : layer.analyticType === 'exceedance' ? 'Exceedance' : 'Persistence'}</span>)}
                    <span className={snapshot ? 'verified' : 'optional'}>{snapshot ? <CheckCircle2 size={14} /> : <Sun size={14} />}Environmental Parameters</span>
                    <span className={morphology?.satellite.status === 'verified' ? 'verified' : 'optional'}>{morphology?.satellite.status === 'verified' ? <CheckCircle2 size={14} /> : <Satellite size={14} />}Satellite Segmentation</span>
                    <span className={morphology?.streetView.status === 'verified' ? 'verified' : 'optional'}>{morphology?.streetView.status === 'verified' ? <CheckCircle2 size={14} /> : <MapPinned size={14} />}Street Segmentation</span>
                    <span className={deepStatus?.ready ? 'verified' : 'optional'}>{deepStatus?.ready ? <CheckCircle2 size={14} /> : <Microscope size={14} />}Heat Intelligence</span>
                  </div>
                  <p>Provider measurements remain provider evidence. Hotspot labels, comparisons and operational implications are HeatShield-derived and never replace missing FortyGuard data with synthetic values.</p>
                </section>
              </>
            )}
          </>
        ) : null}

        {error && <div className="form-error wf-final-error">{error}</div>}
      </main>
    </AppShell>
  )
}
