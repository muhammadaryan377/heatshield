import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CloudRain,
  Download,
  FileText,
  Gauge,
  Leaf,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  ThermometerSun,
  Wind,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type {
  FortyGuardAdvancedSnapshot,
  FortyGuardAnalysis,
  FortyGuardHeatIntelligenceStatus,
  FortyGuardHeatIntelligenceSubmission,
  FortyGuardUsageSummary,
} from '../types/fortyguard-advanced'
import type { Site } from '../types/site'
import '../fortyguard-advanced.css'

const STORAGE_KEY = 'heatshield:selected-site'
const ANALYSES: Array<{ id: FortyGuardAnalysis; label: string; detail: string }> = [
  { id: 'geographic', label: 'Geographic', detail: 'Location and surrounding thermal context' },
  { id: 'environmental', label: 'Environmental', detail: 'Atmosphere, heat stress and environmental conditions' },
  { id: 'urban', label: 'Urban', detail: 'Built form and urban heat context' },
  { id: 'events', label: 'Events', detail: 'Event-linked temperature intelligence' },
  { id: 'anthropogenic', label: 'Anthropogenic', detail: 'Human activity and heat context' },
]

type Granularity = 60 | 80 | 100

function fmt(value?: number | null, unit = '', digits = 1) {
  return value == null || Number.isNaN(value) ? '—' : `${value.toFixed(digits)}${unit}`
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function usagePercent(usage: FortyGuardUsageSummary | null) {
  if (!usage || usage.usedCredits == null || usage.monthlyCredits == null || usage.monthlyCredits <= 0) return null
  return Math.max(0, Math.min(100, usage.usedCredits / usage.monthlyCredits * 100))
}

function Distribution({ values }: { values: number[] }) {
  const sampled = useMemo(() => {
    if (values.length <= 48) return values
    const step = Math.max(1, Math.floor(values.length / 48))
    return values.filter((_, index) => index % step === 0).slice(0, 48)
  }, [values])
  if (!sampled.length) return <div className="fg-advanced-empty-chart">Provider distribution was not returned for this scan.</div>
  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const spread = Math.max(0.001, max - min)
  return (
    <div className="fg-distribution" aria-label="FortyGuard temperature distribution">
      {sampled.map((value, index) => (
        <span key={`${index}-${value}`} style={{ height: `${18 + ((value - min) / spread) * 70}%` }} title={`${value.toFixed(2)}°C`} />
      ))}
    </div>
  )
}

export function FortyGuardIntelligencePage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [scanDate, setScanDate] = useState('')
  const [scanTime, setScanTime] = useState('14:00')
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [snapshot, setSnapshot] = useState<FortyGuardAdvancedSnapshot | null>(null)
  const [scanning, setScanning] = useState(false)
  const [usage, setUsage] = useState<FortyGuardUsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [selectedAnalyses, setSelectedAnalyses] = useState<FortyGuardAnalysis[]>(ANALYSES.map((item) => item.id))
  const [submission, setSubmission] = useState<FortyGuardHeatIntelligenceSubmission | null>(null)
  const [reportStatus, setReportStatus] = useState<FortyGuardHeatIntelligenceStatus | null>(null)
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSite = useMemo(() => sites.find((site) => site.id === siteId) ?? null, [siteId, sites])
  const usedPercent = usagePercent(usage)
  const maxDate = localDateString(new Date())

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        const stored = localStorage.getItem(STORAGE_KEY)
        setSiteId(stored && loaded.some((site) => site.id === stored) ? stored : loaded[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load sites.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSites(false)
      })
    return () => controller.abort()
  }, [])

  const refreshUsage = async () => {
    setUsageLoading(true)
    try {
      setUsage(await api.getFortyGuardUsage())
    } catch (err) {
      setUsage({ dataStatus: 'unavailable', activityBreakdown: {}, raw: {}, message: err instanceof Error ? err.message : 'Unable to read FortyGuard usage.' })
    } finally {
      setUsageLoading(false)
    }
  }

  useEffect(() => {
    void refreshUsage()
  }, [])

  useEffect(() => {
    if (!submission?.activityId || reportStatus?.ready || reportStatus?.status === 'failed') return
    let cancelled = false
    let attempts = 0
    const check = async () => {
      attempts += 1
      try {
        const status = await api.getFortyGuardHeatIntelligenceStatus(submission.activityId)
        if (!cancelled) setReportStatus(status)
      } catch (err) {
        if (!cancelled) setReportStatus({
          activityId: submission.activityId,
          status: 'unknown',
          ready: false,
          message: err instanceof Error ? err.message : 'Unable to check provider report status.',
        })
      }
    }
    void check()
    const timer = window.setInterval(() => {
      if (attempts >= 100) {
        window.clearInterval(timer)
        return
      }
      void check()
    }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [submission?.activityId, reportStatus?.ready, reportStatus?.status])

  const runSnapshot = async () => {
    if (!selectedSite || scanning) return
    setScanning(true)
    setError(null)
    localStorage.setItem(STORAGE_KEY, selectedSite.id)
    try {
      const result = await api.generateFortyGuardAdvancedSnapshot(selectedSite.id, {
        date: scanDate || undefined,
        time: scanDate ? scanTime : undefined,
        granularityMeters: granularity,
      })
      setSnapshot(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run FortyGuard intelligence scan.')
    } finally {
      setScanning(false)
    }
  }

  const toggleAnalysis = (analysis: FortyGuardAnalysis) => {
    setSelectedAnalyses((current) => current.includes(analysis)
      ? current.filter((item) => item !== analysis)
      : [...current, analysis])
  }

  const generateReport = async () => {
    if (!selectedSite || reportSubmitting || selectedAnalyses.length === 0) return
    setReportSubmitting(true)
    setError(null)
    setSubmission(null)
    setReportStatus(null)
    try {
      const result = await api.submitFortyGuardHeatIntelligence(selectedSite.id, {
        date: scanDate || undefined,
        time: scanDate ? scanTime : undefined,
        granularityMeters: granularity,
        analysis: selectedAnalyses,
      })
      setSubmission(result)
      setReportStatus({ activityId: result.activityId, status: 'processing', ready: false, message: 'FortyGuard is generating the report.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit Heat Intelligence report.')
    } finally {
      setReportSubmitting(false)
    }
  }

  const downloadReport = async () => {
    if (!submission?.activityId || downloading) return
    setDownloading(true)
    setError(null)
    try {
      const blob = await api.downloadFortyGuardHeatIntelligence(submission.activityId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `heatshield-fortyguard-${selectedSite?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'report'}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download FortyGuard report.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <AppShell module="enterprise">
      <header className="fg-advanced-topbar">
        <div>
          <span>FORTYGUARD EVIDENCE CORE</span>
          <h1>Temperature Intelligence Hub</h1>
          <p>Full provider evidence, map statistics, environmental parameters, report generation and credit health.</p>
        </div>
        <Link to="/enterprise/reports" className="button button--outline-teal"><FileText size={16} /> Enterprise Reports</Link>
      </header>

      <main className="fg-advanced-page">
        {loadingSites && <StatePanel kind="loading" title="Loading FortyGuard workspace" detail="Reading HeatShield site geometry…" />}
        {!loadingSites && !sites.length && <StatePanel kind="empty" title="No sites available" detail="Create a site before requesting provider intelligence." />}

        {!loadingSites && sites.length > 0 && (
          <>
            <section className="fg-advanced-hero">
              <div>
                <span className="fg-advanced-eyebrow"><Sparkles size={14} /> PROVIDER CAPABILITY COMPLETE</span>
                <h2>Use the full FortyGuard signal, not only temperature.</h2>
                <p>HeatShield keeps provider measurements auditable, then uses them as evidence for workforce, enterprise, agriculture and urban decisions.</p>
              </div>
              <div className="fg-advanced-badges">
                <span><ShieldCheck size={15} /> No synthetic provider values</span>
                <span><Activity size={15} /> Archive from 2019</span>
                <span><Zap size={15} /> Premium-aware</span>
              </div>
            </section>

            <section className="fg-advanced-controls panel">
              <label><span>Site</span><select value={siteId ?? ''} onChange={(event) => { setSiteId(event.target.value); setSnapshot(null); setSubmission(null); setReportStatus(null) }}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
              <label><span>Evidence date</span><input type="date" min="2019-01-01" max={maxDate} value={scanDate} onChange={(event) => setScanDate(event.target.value)} /><small>Blank = latest verified hour</small></label>
              <label><span>Local time</span><input type="time" value={scanTime} onChange={(event) => setScanTime(event.target.value)} disabled={!scanDate} /></label>
              <label><span>Resolution</span><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as Granularity)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></label>
              <button type="button" className="button button--primary" onClick={() => void runSnapshot()} disabled={scanning}>{scanning ? <Loader2 size={16} className="spin" /> : <ThermometerSun size={16} />}{scanning ? 'Scanning…' : 'Run Full Scan'}</button>
              {scanDate && <button type="button" className="button button--secondary" onClick={() => setScanDate('')}>Use Latest</button>}
            </section>

            {error && <div className="fg-advanced-warning"><AlertTriangle size={16} /> {error}</div>}

            <section className="fg-usage panel">
              <div className="fg-section-head"><div><span>PROVIDER OPERATIONS</span><h2>FortyGuard Credit Health</h2><p>Billing-cycle usage is read server-side. The API key is never returned to the browser.</p></div><button type="button" className="button button--secondary" onClick={() => void refreshUsage()} disabled={usageLoading}>{usageLoading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Refresh</button></div>
              {usage?.dataStatus === 'verified' ? (
                <div className="fg-usage-grid">
                  <article><span>Plan</span><strong>{usage.plan ?? 'Provider plan'}</strong><small>{usage.message}</small></article>
                  <article><span>Credits remaining</span><strong>{usage.remainingCredits == null ? '—' : usage.remainingCredits.toLocaleString()}</strong><small>{usage.monthlyCredits == null ? 'Monthly allowance not normalized' : `of ${usage.monthlyCredits.toLocaleString()}`}</small></article>
                  <article><span>Credits used</span><strong>{usage.usedCredits == null ? '—' : usage.usedCredits.toLocaleString()}</strong><small>{usedPercent == null ? 'Usage percentage unavailable' : `${usedPercent.toFixed(1)}% of allowance`}</small></article>
                  <article><span>Reset</span><strong>{usage.creditsResetDate ?? '—'}</strong><small>{Object.keys(usage.activityBreakdown).length} activity categories returned</small></article>
                  {usedPercent != null && <div className="fg-credit-meter"><span style={{ width: `${usedPercent}%` }} /></div>}
                </div>
              ) : <div className="fg-inline-state"><Gauge size={20} /><div><strong>Credit usage unavailable</strong><span>{usage?.message ?? 'Provider usage has not been loaded.'}</span></div></div>}
            </section>

            {!snapshot ? (
              <section className="fg-advanced-placeholder panel"><BarChart3 size={32} /><h2>Run a full scan</h2><p>The scan reuses one matched TCM layer for spatial statistics and requests the environmental payload for the same site, temperature and time.</p></section>
            ) : (
              <>
                <section className="fg-scan-meta panel">
                  <div><span>DATA STATUS</span><strong className={snapshot.dataStatus}>{snapshot.dataStatus}</strong></div>
                  <div><span>OBSERVED</span><strong>{formatDateTime(snapshot.observedAt)}</strong><small>{snapshot.timezoneName}{snapshot.sourceAgeHours ? ` · ${snapshot.sourceAgeHours}h fallback` : ''}</small></div>
                  <div><span>THERMAL CELLS</span><strong>{snapshot.mapStatistics.tileCount}</strong><small>{snapshot.granularityMeters} m provider grid</small></div>
                  <div><span>ENV SIGNALS</span><strong>{snapshot.environment.availableMetricCount}</strong><small>non-sentinel metrics returned</small></div>
                </section>

                {snapshot.warnings.length > 0 && <div className="fg-advanced-warning"><AlertTriangle size={16} /><span>{snapshot.warnings.join(' ')}</span></div>}

                <div className="fg-advanced-grid">
                  <section className="panel fg-evidence-card fg-evidence-card--thermal">
                    <div className="fg-section-head"><div><span>MAP STATISTICS</span><h2>Spatial Thermal Distribution</h2><p>FortyGuard TCM statistics from the selected site polygon.</p></div><ThermometerSun size={22} /></div>
                    <div className="fg-metric-grid four">
                      <article><span>Minimum</span><strong>{fmt(snapshot.mapStatistics.minTemperatureC, '°C')}</strong></article>
                      <article><span>Mean</span><strong>{fmt(snapshot.mapStatistics.meanTemperatureC, '°C')}</strong></article>
                      <article><span>Maximum</span><strong>{fmt(snapshot.mapStatistics.maxTemperatureC, '°C')}</strong></article>
                      <article><span>Std. deviation</span><strong>{fmt(snapshot.mapStatistics.standardDeviationC, '°C', 2)}</strong></article>
                    </div>
                    <Distribution values={snapshot.mapStatistics.distribution.overallC} />
                    <div className="fg-provider-id">Heatmap activity <code>{snapshot.heatmapActivityId}</code></div>
                  </section>

                  <section className="panel fg-evidence-card">
                    <div className="fg-section-head"><div><span>THERMAL STRESS</span><h2>Human Heat Exposure</h2><p>Same-time environmental evidence from FortyGuard.</p></div><Activity size={22} /></div>
                    <div className="fg-metric-grid">
                      <article><span>Site temperature</span><strong>{fmt(snapshot.temperatureC, '°C')}</strong></article>
                      <article><span>Heat index</span><strong>{fmt(snapshot.environment.heatIndexC, '°C')}</strong></article>
                      <article><span>Apparent</span><strong>{fmt(snapshot.environment.apparentTemperatureC, '°C')}</strong></article>
                      <article className="fg-metric-emphasis"><span>Wet bulb</span><strong>{fmt(snapshot.environment.wetBulbTemperatureC, '°C')}</strong></article>
                      <article><span>Humidity</span><strong>{fmt(snapshot.environment.relativeHumidityPercent, '%')}</strong></article>
                      <article><span>Elevation</span><strong>{fmt(snapshot.environment.elevationM, ' m', 0)}</strong></article>
                    </div>
                  </section>

                  <section className="panel fg-evidence-card">
                    <div className="fg-section-head"><div><span>ATMOSPHERE</span><h2>Air & Hydrology</h2><p>Pollution, precipitation and cloud metrics are shown only when returned.</p></div><Wind size={22} /></div>
                    <div className="fg-metric-grid">
                      <article><span>US AQI</span><strong>{fmt(snapshot.environment.airQuality.aqiUs, '', 0)}</strong></article>
                      <article><span>PM2.5 AQI</span><strong>{fmt(snapshot.environment.airQuality.pm25Aqi, '', 0)}</strong></article>
                      <article><span>PM10 AQI</span><strong>{fmt(snapshot.environment.airQuality.pm10Aqi, '', 0)}</strong></article>
                      <article><span>O₃ AQI</span><strong>{fmt(snapshot.environment.airQuality.o3Aqi, '', 0)}</strong></article>
                      <article><span>NO₂ AQI</span><strong>{fmt(snapshot.environment.airQuality.no2Aqi, '', 0)}</strong></article>
                      <article><span>SO₂ AQI</span><strong>{fmt(snapshot.environment.airQuality.so2Aqi, '', 0)}</strong></article>
                      <article><span>CO AQI</span><strong>{fmt(snapshot.environment.airQuality.coAqi, '', 0)}</strong></article>
                      <article><span>Precipitation</span><strong>{fmt(snapshot.environment.precipitationMm, ' mm', 2)}</strong></article>
                      <article><span>Cloud metric</span><strong>{fmt(snapshot.environment.cloudCoverMetric, '', 1)}</strong></article>
                      <article><span>CO₂</span><strong>{fmt(snapshot.environment.co2Ppm, ' ppm', 0)}</strong></article>
                      <article><span>Methane</span><strong>{fmt(snapshot.environment.methanePpb, ' ppb', 0)}</strong></article>
                    </div>
                  </section>

                  <section className="panel fg-evidence-card fg-evidence-card--solar">
                    <div className="fg-section-head"><div><span>SOLAR LOAD</span><h2>Clear-Sky Irradiance</h2><p>Useful for crop stress, solar exposure, cooling demand and urban intervention planning.</p></div><Sun size={22} /></div>
                    <div className="fg-metric-grid three">
                      <article><span>GHI</span><strong>{fmt(snapshot.environment.solar.ghiWm2, ' W/m²', 0)}</strong></article>
                      <article><span>DNI</span><strong>{fmt(snapshot.environment.solar.dniWm2, ' W/m²', 0)}</strong></article>
                      <article><span>DHI</span><strong>{fmt(snapshot.environment.solar.dhiWm2, ' W/m²', 0)}</strong></article>
                    </div>
                    {snapshot.environment.solar.description && <p className="fg-provider-note">{snapshot.environment.solar.description}</p>}
                    {snapshot.environmentActivityId && <div className="fg-provider-id">Environment activity <code>{snapshot.environmentActivityId}</code></div>}
                  </section>
                </div>
              </>
            )}

            <section className="fg-report panel">
              <div className="fg-section-head"><div><span>PREMIUM REPORT ENGINE</span><h2>FortyGuard Heat Intelligence</h2><p>Generate the provider's multidimensional PDF while HeatShield keeps its own recommendations separate.</p></div><FileText size={23} /></div>
              <div className="fg-analysis-grid">
                {ANALYSES.map((item) => {
                  const checked = selectedAnalyses.includes(item.id)
                  return <button key={item.id} type="button" className={checked ? 'selected' : ''} onClick={() => toggleAnalysis(item.id)}><span>{checked ? <CheckCircle2 size={17} /> : <span className="fg-check-placeholder" />}{item.label}</span><small>{item.detail}</small></button>
                })}
              </div>
              <div className="fg-report-actions">
                <button type="button" className="button button--primary" onClick={() => void generateReport()} disabled={reportSubmitting || selectedAnalyses.length === 0}>{reportSubmitting ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{reportSubmitting ? 'Submitting…' : 'Generate Provider Report'}</button>
                {reportStatus && <div className={`fg-report-status ${reportStatus.status}`}><span /> <strong>{reportStatus.status}</strong><small>{reportStatus.message}</small></div>}
                <button type="button" className="button button--secondary" disabled={!reportStatus?.ready || downloading} onClick={() => void downloadReport()}>{downloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}{downloading ? 'Downloading…' : 'Download PDF'}</button>
              </div>
              {submission && <div className="fg-provider-id">Report activity <code>{submission.activityId}</code> · evidence {formatDateTime(submission.observedAt)} · {fmt(submission.temperatureC, '°C')}</div>}
              <div className="fg-report-policy"><ShieldCheck size={16} /><span>The temporary provider download URL is never exposed to the browser. HeatShield retrieves the completed PDF server-side and proxies only validated PDF bytes.</span></div>
            </section>

            <section className="fg-capability-strip">
              <article><Leaf size={18} /><div><strong>Workforce</strong><span>Wet bulb + AQI + solar exposure</span></div></article>
              <article><Zap size={18} /><div><strong>Enterprise</strong><span>Distribution + irradiance + provider report</span></div></article>
              <article><CloudRain size={18} /><div><strong>Agriculture</strong><span>Humidity + precipitation + solar load</span></div></article>
              <article><Sun size={18} /><div><strong>Urban</strong><span>Thermal + environmental + morphology context</span></div></article>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
