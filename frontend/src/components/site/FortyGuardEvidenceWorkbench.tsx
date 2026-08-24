import {
  Activity,
  BarChart3,
  Building2,
  CheckCircle2,
  CloudSun,
  Download,
  Gauge,
  Image as ImageIcon,
  Leaf,
  LoaderCircle,
  RefreshCw,
  Satellite,
  Sparkles,
  Sun,
  ThermometerSun,
  TriangleAlert,
  Waves,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  api,
  resolveApiPath,
  type FortyGuardEnvironmentalContext,
  type FortyGuardHeatIntelligence,
  type FortyGuardPhysicalContext,
  type FortyGuardSegmentationView,
  type FortyGuardUsage,
  type HeatIntelligenceCategory,
} from '../../lib/api'
import './FortyGuardEvidenceWorkbench.css'

interface FortyGuardEvidenceWorkbenchProps {
  siteId: string
}

type BusyKey = 'environment' | 'physical' | 'report' | 'usage' | null

const REPORT_CATEGORIES: { id: HeatIntelligenceCategory; label: string }[] = [
  { id: 'geographic', label: 'Geographic' },
  { id: 'environmental', label: 'Environmental' },
  { id: 'urban', label: 'Urban' },
  { id: 'events', label: 'Events' },
  { id: 'anthropogenic', label: 'Anthropogenic' },
]

function statusLabel(status?: string | null) {
  if (!status) return 'Not requested'
  if (status === 'premium_required') return 'Premium access required'
  if (status === 'configuration_required') return 'Configuration required'
  return status.replaceAll('_', ' ')
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function metric(value?: number | null, unit = '', digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}${unit}`
}

function topSegments(view?: FortyGuardSegmentationView | null) {
  if (!view) return []
  return Object.entries(view.segments)
    .filter(([, value]) => Number.isFinite(value))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
}

function SegmentationPanel({ title, icon, view }: { title: string; icon: React.ReactNode; view?: FortyGuardSegmentationView | null }) {
  if (!view) return null
  const segments = topSegments(view)
  return (
    <article className="fg-workbench__segmentation">
      <header>
        <span className="fg-workbench__module-icon">{icon}</span>
        <div><strong>{title}</strong><small>{view.imageDate ?? (view.imageYear ? `Imagery ${view.imageYear}` : 'Provider imagery')}</small></div>
        <span className={`fg-provider-status fg-provider-status--${view.status}`}>{statusLabel(view.status)}</span>
      </header>

      {view.status === 'verified' ? <>
        <div className="fg-workbench__image-grid">
          {view.imageDataUrl ? <figure><img src={view.imageDataUrl} alt={`${title} original provider view`} /><figcaption>Original</figcaption></figure> : <div className="fg-workbench__image-empty"><ImageIcon size={20} /> Original image not returned</div>}
          {view.segmentedImageDataUrl ? <figure><img src={view.segmentedImageDataUrl} alt={`${title} segmented provider view`} /><figcaption>Segmentation</figcaption></figure> : <div className="fg-workbench__image-empty"><ImageIcon size={20} /> Segmented image not returned</div>}
        </div>
        {segments.length > 0 && <div className="fg-workbench__segments">
          {segments.map(([label, value]) => <div key={label}><span>{label.replaceAll('_', ' ')}</span><strong>{value.toFixed(1)}%</strong><i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></div>)}
        </div>}
      </> : <div className="fg-workbench__module-message"><TriangleAlert size={16} /><span>{view.message ?? 'This provider layer is not available for the current API entitlement.'}</span></div>}

      {view.activityId && <footer>Activity ID <code>{view.activityId}</code></footer>}
    </article>
  )
}

export function FortyGuardEvidenceWorkbench({ siteId }: FortyGuardEvidenceWorkbenchProps) {
  const [busy, setBusy] = useState<BusyKey>(null)
  const [error, setError] = useState<string | null>(null)
  const [environment, setEnvironment] = useState<FortyGuardEnvironmentalContext | null>(null)
  const [physical, setPhysical] = useState<FortyGuardPhysicalContext | null>(null)
  const [report, setReport] = useState<FortyGuardHeatIntelligence | null>(null)
  const [usage, setUsage] = useState<FortyGuardUsage | null>(null)
  const [categories, setCategories] = useState<HeatIntelligenceCategory[]>(REPORT_CATEGORIES.map((item) => item.id))
  const [includeBackView, setIncludeBackView] = useState(false)

  const environmentalMetrics = useMemo(() => environment ? [
    { label: 'Wet bulb', value: metric(environment.wetBulbTemperatureC, '°C'), icon: <Waves size={17} /> },
    { label: 'Apparent temp', value: metric(environment.apparentTemperatureC, '°C'), icon: <ThermometerSun size={17} /> },
    { label: 'Heat index', value: metric(environment.heatIndexC, '°C'), icon: <Gauge size={17} /> },
    { label: 'Humidity', value: metric(environment.relativeHumidityPercent, '%', 0), icon: <CloudSun size={17} /> },
    { label: 'US AQI', value: metric(environment.aqiUs, '', 0), icon: <Activity size={17} /> },
    { label: 'Solar GHI', value: metric(environment.solarGhi, ' W/m²', 0), icon: <Sun size={17} /> },
    { label: 'PM2.5 AQI', value: metric(environment.aqiPm25, '', 0), icon: <BarChart3 size={17} /> },
    { label: 'CO₂', value: metric(environment.co2Ppm, ' ppm', 0), icon: <Leaf size={17} /> },
  ] : [], [environment])

  const run = async (key: Exclude<BusyKey, null>, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FortyGuard request could not complete.')
    } finally {
      setBusy(null)
    }
  }

  const loadEnvironment = (forceRefresh = false) => run('environment', async () => {
    setEnvironment(await api.getFortyGuardEnvironment(siteId, forceRefresh))
  })

  const loadPhysical = () => run('physical', async () => {
    setPhysical(await api.getFortyGuardPhysicalContext(siteId, {
      granularityMeters: 80,
      includeSatellite: true,
      includeStreetView: true,
      streetHorizontalAngle: 0,
      streetVerticalAngle: 0,
      streetBackView: includeBackView,
    }))
  })

  const generateReport = () => run('report', async () => {
    if (!categories.length) throw new Error('Choose at least one Heat Intelligence category.')
    setReport(await api.generateFortyGuardHeatIntelligence(siteId, categories))
  })

  const loadUsage = () => run('usage', async () => {
    setUsage(await api.getFortyGuardUsage())
  })

  const toggleCategory = (category: HeatIntelligenceCategory) => {
    setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])
    setReport(null)
  }

  return (
    <section className="fg-workbench panel">
      <header className="fg-workbench__header">
        <div className="fg-workbench__brand"><span><Sparkles size={19} /></span><div><small>FORTYGUARD INTELLIGENCE SUITE</small><h2>Provider Evidence Workbench</h2><p>Go beyond temperature: environmental stress, physical site context, provider reports and API usage — all traceable to FortyGuard.</p></div></div>
        <div className="fg-workbench__capabilities"><span>TCM</span><span>Environment</span><span>Segmentation</span><span>Heat Intelligence</span></div>
      </header>

      {error && <div className="fg-workbench__error"><TriangleAlert size={17} /><span>{error}</span></div>}

      <div className="fg-workbench__module-grid">
        <article className="fg-workbench__module">
          <div className="fg-workbench__module-head">
            <span className="fg-workbench__module-icon"><ThermometerSun size={19} /></span>
            <div><small>ENVIRONMENTAL PARAMETERS</small><h3>Heat stress context</h3><p>Wet bulb, apparent temperature, humidity, AQI and solar evidence tied to the matched FortyGuard observation.</p></div>
          </div>
          {!environment ? <button type="button" className="button button--secondary" disabled={busy !== null} onClick={() => void loadEnvironment()}>{busy === 'environment' ? <LoaderCircle className="fg-spin" size={16} /> : <Gauge size={16} />} Load environmental evidence</button> : <>
            <div className="fg-workbench__status-row"><span className={`fg-provider-status fg-provider-status--${environment.dataStatus}`}><CheckCircle2 size={13} /> {statusLabel(environment.dataStatus)}</span><span>{formatDateTime(environment.observedAt)}</span><button type="button" onClick={() => void loadEnvironment(true)} disabled={busy !== null}><RefreshCw size={14} /> Fresh</button></div>
            <div className="fg-workbench__metrics">{environmentalMetrics.map((item) => <div key={item.label}><span>{item.icon}{item.label}</span><strong>{item.value}</strong></div>)}</div>
            {environment.message && <p className="fg-workbench__note">{environment.message}</p>}
            <div className="fg-workbench__trace"><span>Environmental activity</span><code>{environment.activityId ?? 'not returned'}</code><span>TCM activity</span><code>{environment.heatmapActivityId ?? 'not returned'}</code></div>
          </>}
        </article>

        <article className="fg-workbench__module">
          <div className="fg-workbench__module-head">
            <span className="fg-workbench__module-icon"><Satellite size={19} /></span>
            <div><small>PHYSICAL CONTEXT</small><h3>Satellite + Street View</h3><p>Request provider imagery segmentation to understand the built and vegetated context around the selected site.</p></div>
          </div>
          <label className="fg-workbench__toggle"><input type="checkbox" checked={includeBackView} onChange={(event) => { setIncludeBackView(event.target.checked); setPhysical(null) }} /><span>Include rear Street View</span></label>
          <button type="button" className="button button--secondary" disabled={busy !== null} onClick={() => void loadPhysical()}>{busy === 'physical' ? <LoaderCircle className="fg-spin" size={16} /> : <Satellite size={16} />} Analyze physical context</button>
          {physical && <div className="fg-workbench__status-row fg-workbench__status-row--physical"><span className={`fg-provider-status fg-provider-status--${physical.dataStatus}`}>{statusLabel(physical.dataStatus)}</span><span>{physical.message}</span></div>}
        </article>

        <article className="fg-workbench__module">
          <div className="fg-workbench__module-head">
            <span className="fg-workbench__module-icon"><Sparkles size={19} /></span>
            <div><small>HEAT INTELLIGENCE</small><h3>Deep provider report</h3><p>Generate FortyGuard&apos;s geographic, environmental, urban, event and anthropogenic analysis as a traceable PDF.</p></div>
          </div>
          <div className="fg-workbench__category-grid">{REPORT_CATEGORIES.map((item) => <label key={item.id}><input type="checkbox" checked={categories.includes(item.id)} onChange={() => toggleCategory(item.id)} /><span>{item.label}</span></label>)}</div>
          <button type="button" className="button button--primary" disabled={busy !== null || !categories.length} onClick={() => void generateReport()}>{busy === 'report' ? <LoaderCircle className="fg-spin" size={16} /> : <Sparkles size={16} />} Generate Heat Intelligence</button>
          {report && <div className="fg-workbench__report-result"><span className={`fg-provider-status fg-provider-status--${report.dataStatus}`}>{statusLabel(report.dataStatus)}</span><p>{report.message}</p>{report.downloadPath && <a className="button button--secondary" href={resolveApiPath(report.downloadPath)} target="_blank" rel="noreferrer"><Download size={15} /> Open provider PDF</a>}{report.activityId && <small>Activity ID <code>{report.activityId}</code></small>}</div>}
        </article>

        <article className="fg-workbench__module">
          <div className="fg-workbench__module-head">
            <span className="fg-workbench__module-icon"><Activity size={19} /></span>
            <div><small>API OPERATIONS</small><h3>Credits + usage</h3><p>Read provider usage separately from heat evidence so supervisors can see the operational cost of advanced analyses.</p></div>
          </div>
          {!usage ? <button type="button" className="button button--secondary" disabled={busy !== null} onClick={() => void loadUsage()}>{busy === 'usage' ? <LoaderCircle className="fg-spin" size={16} /> : <Activity size={16} />} Check FortyGuard usage</button> : <>
            <div className="fg-workbench__usage-grid"><div><span>Plan</span><strong>{usage.plan ?? 'Provider account'}</strong></div><div><span>Credits used</span><strong>{usage.creditsUsed ?? '—'}</strong></div><div><span>Remaining</span><strong>{usage.creditsRemaining ?? '—'}</strong></div><div><span>Limit</span><strong>{usage.creditsLimit ?? '—'}</strong></div></div>
            <div className="fg-workbench__status-row"><span className={`fg-provider-status fg-provider-status--${usage.dataStatus}`}>{statusLabel(usage.dataStatus)}</span><span>{usage.creditsResetDate ? `Reset ${usage.creditsResetDate}` : formatDateTime(usage.fetchedAt)}</span><button type="button" onClick={() => void loadUsage()} disabled={busy !== null}><RefreshCw size={14} /> Refresh</button></div>
            {usage.message && <p className="fg-workbench__note">{usage.message}</p>}
          </>}
        </article>
      </div>

      {physical && <div className="fg-workbench__physical-results">
        <SegmentationPanel title="Satellite segmentation" icon={<Satellite size={18} />} view={physical.satellite} />
        <SegmentationPanel title="Street View · front" icon={<Building2 size={18} />} view={physical.streetFront} />
        <SegmentationPanel title="Street View · back" icon={<Building2 size={18} />} view={physical.streetBack} />
      </div>}

      <footer className="fg-workbench__footer"><Activity size={15} /><span>Advanced requests run only when you click them. Premium-only FortyGuard features surface a plan/entitlement state instead of fabricated data.</span></footer>
    </section>
  )
}
