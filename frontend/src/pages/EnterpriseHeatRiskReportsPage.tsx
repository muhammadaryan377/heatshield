import {
  AlertTriangle,
  Archive,
  BarChart3,
  Box,
  Building2,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  Factory,
  FileText,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  ThermometerSun,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { EnterpriseAsset } from '../types/asset'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../types/history'
import type {
  EnterpriseHeatRiskReport,
  EnterpriseReportAssetFinding,
  EnterpriseReportPriority,
  EnterpriseReportTemplate,
} from '../types/enterprise-report'
import type { Coordinate, Site, SiteIntelligence, ThermalMapResponse, ThermalTile } from '../types/site'
import '../enterprise-heat-risk-reports.css'

const STORAGE_KEY = 'heatshield:selected-site'
const REPORT_LIBRARY_KEY = 'heatshield:enterprise-report-library:v1'
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

function celsiusToFahrenheit(value: number) {
  return value * 9 / 5 + 32
}

function pointOnSegment(point: Coordinate, a: Coordinate, b: Coordinate, epsilon = 1e-9) {
  const cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng)
  if (Math.abs(cross) > epsilon) return false
  return point.lng >= Math.min(a.lng, b.lng) - epsilon
    && point.lng <= Math.max(a.lng, b.lng) + epsilon
    && point.lat >= Math.min(a.lat, b.lat) - epsilon
    && point.lat <= Math.max(a.lat, b.lat) + epsilon
}

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  if (polygon.length < 3) return false
  for (let index = 0; index < polygon.length; index += 1) {
    const previous = polygon[index === 0 ? polygon.length - 1 : index - 1]
    if (pointOnSegment(point, previous, polygon[index])) return true
  }
  let inside = false
  let j = polygon.length - 1
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    if ((current.lat > point.lat) !== (previous.lat > point.lat)) {
      const denominator = previous.lat - current.lat
      if (Math.abs(denominator) > 1e-12) {
        const crossingLng = (previous.lng - current.lng) * (point.lat - current.lat) / denominator + current.lng
        if (point.lng < crossingLng) inside = !inside
      }
    }
    j = i
  }
  return inside
}

function findThermalTile(coordinate: Coordinate, tiles: ThermalTile[]) {
  return tiles.find((tile) => pointInPolygon(coordinate, tile.polygon)) ?? null
}

function findHistoricalCell(coordinate: Coordinate, cells: HistoricalHeatCell[]) {
  return cells.find((cell) => pointInPolygon(coordinate, cell.polygon)) ?? null
}

function templateLabel(template: EnterpriseReportTemplate) {
  if (template === 'property') return 'Property Exposure'
  if (template === 'assets') return 'Asset Risk'
  if (template === 'industrial') return 'Industrial / Data Center'
  return 'Executive'
}

function temperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
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

function reportPriority(
  evidenceAvailable: boolean,
  peakTemperatureC: number | null,
  thresholdC: number,
  maxPersistenceHours: number | null,
  meanExceedanceHours: number | null,
  heatLimitBreaches: number,
  businessCriticalAssets: number,
): EnterpriseReportPriority {
  if (!evidenceAvailable) return 'unassessed'
  if (heatLimitBreaches > 0 || ((peakTemperatureC ?? -999) >= thresholdC + 8 && businessCriticalAssets > 0)) return 'critical'
  if ((maxPersistenceHours ?? 0) >= 6 || (peakTemperatureC ?? -999) >= thresholdC + 6 || (businessCriticalAssets >= 3 && (maxPersistenceHours ?? 0) >= 3)) return 'high'
  if ((maxPersistenceHours ?? 0) >= 3 || (meanExceedanceHours ?? 0) >= 3 || (peakTemperatureC ?? -999) >= thresholdC + 3) return 'attention'
  return 'monitor'
}

function priorityHeadline(priority: EnterpriseReportPriority) {
  if (priority === 'critical') return 'Immediate engineering review is warranted'
  if (priority === 'high') return 'High-priority thermal exposure requires action planning'
  if (priority === 'attention') return 'Material heat exposure should remain in active review'
  if (priority === 'monitor') return 'Current evidence supports monitoring rather than escalation'
  return 'Verified evidence is insufficient for a HeatShield conclusion'
}

function buildAssetFindings(
  assets: EnterpriseAsset[],
  thermal: ThermalMapResponse | null,
  history: HistoricalHeatBehaviorResponse | null,
): EnterpriseReportAssetFinding[] {
  return assets.map((asset) => {
    const tile = thermal?.dataStatus === 'verified' ? findThermalTile(asset.coordinate, thermal.tiles) : null
    const historicalCell = history && ['verified', 'partial'].includes(history.dataStatus)
      ? findHistoricalCell(asset.coordinate, history.cells)
      : null
    const latestTemperatureC = tile?.temperatureC ?? null
    const heatLimitExceeded = asset.heatLimitC != null && latestTemperatureC != null && latestTemperatureC >= asset.heatLimitC
    return {
      assetId: asset.id,
      assetCode: asset.assetCode,
      name: asset.name,
      type: asset.type,
      criticality: asset.criticality,
      latestTemperatureC,
      exceedanceHours: historicalCell?.exceedanceHours ?? null,
      persistenceHours: historicalCell?.persistenceHours ?? null,
      peakHourLocal: historicalCell?.peakHourLocal ?? null,
      heatLimitC: asset.heatLimitC,
      heatLimitExceeded,
      evidenceMatched: Boolean(tile || historicalCell),
    }
  })
}

function buildReport(
  site: Site,
  template: EnterpriseReportTemplate,
  completedDay: string,
  thresholdC: number,
  granularity: Granularity,
  assets: EnterpriseAsset[],
  intelligence: SiteIntelligence | null,
  thermal: ThermalMapResponse | null,
  history: HistoricalHeatBehaviorResponse | null,
): EnterpriseHeatRiskReport {
  const thermalVerified = thermal?.dataStatus === 'verified'
  const historyVerified = Boolean(history && ['verified', 'partial'].includes(history.dataStatus))
  const evidenceState = thermalVerified && historyVerified ? 'verified' : thermalVerified || historyVerified ? 'partial' : 'unavailable'
  const assetFindings = buildAssetFindings(assets, thermal, history)
  const businessCritical = assets.filter((asset) => asset.criticality === 'high' || asset.criticality === 'critical').length
  const matched = assetFindings.filter((item) => item.evidenceMatched).length
  const coolingDependent = assets.filter((asset) => asset.coolingDependent).length
  const heatLimitBreaches = assetFindings.filter((item) => item.heatLimitExceeded).length
  const priority = reportPriority(
    evidenceState !== 'unavailable',
    thermal?.maxTemperatureC ?? null,
    thresholdC,
    history?.maxPersistenceHours ?? null,
    history?.meanExceedanceHours ?? null,
    heatLimitBreaches,
    businessCritical,
  )

  const findings: string[] = []
  if (thermal?.maxTemperatureC != null) findings.push(`Latest verified peak surface temperature is ${thermal.maxTemperatureC.toFixed(1)}°C.`)
  if (history?.maxPersistenceHours != null) findings.push(`Maximum selected-day heat persistence is ${history.maxPersistenceHours.toFixed(1)} hours.`)
  if (history?.meanExceedanceHours != null) findings.push(`Mean exceedance above ${thresholdC.toFixed(1)}°C is ${history.meanExceedanceHours.toFixed(1)} hours.`)
  if (history?.commonPeakPeriodLocal || history?.commonPeakHourLocal) findings.push(`Common peak exposure period is ${history.commonPeakPeriodLocal ?? history.commonPeakHourLocal}.`)
  if (heatLimitBreaches) findings.push(`${heatLimitBreaches} registered asset${heatLimitBreaches === 1 ? '' : 's'} exceed configured thermal limits in the matched latest surface layer.`)
  if (businessCritical) findings.push(`${businessCritical} registered asset${businessCritical === 1 ? '' : 's'} carry high or critical business importance.`)
  if (assets.length && matched < assets.length) findings.push(`${assets.length - matched} asset${assets.length - matched === 1 ? '' : 's'} do not currently match returned FortyGuard spatial cells.`)
  if (!assets.length) findings.push('No enterprise assets are registered for this site, so infrastructure exposure cannot be evaluated.')
  if (evidenceState === 'unavailable') findings.push('No verified spatial thermal or selected-day historical layer is available for this report run.')

  const actions: string[] = []
  if (heatLimitBreaches) actions.push('Review each configured asset thermal-limit breach and validate operating margin before the next peak period.')
  if ((history?.maxPersistenceHours ?? 0) >= 3) actions.push('Investigate permanent mitigation for cells with repeated or persistent heat rather than relying only on short-term operational controls.')
  if (history?.commonPeakPeriodLocal || history?.commonPeakHourLocal) actions.push(`Schedule nonessential testing, maintenance and outdoor servicing outside the ${history.commonPeakPeriodLocal ?? history.commonPeakHourLocal} peak window when practical.`)
  if (coolingDependent) actions.push(`Verify cooling performance for ${coolingDependent} cooling-dependent registered asset${coolingDependent === 1 ? '' : 's'} during high-exposure periods.`)
  if (!assets.length) actions.push('Register critical infrastructure locations so HeatShield can connect spatial heat evidence to enterprise consequences.')
  if (evidenceState !== 'verified') actions.push('Restore the missing FortyGuard layer before treating this report as a complete thermal risk record.')
  if (!actions.length) actions.push('Continue monitoring and regenerate this evidence package for hotter completed days or after site conditions change.')

  const conditionSource = intelligence?.conditionSourceLabel ?? intelligence?.conditionSource ?? null
  const summary = priority === 'unassessed'
    ? 'HeatShield has not produced an operational conclusion because the required verified spatial evidence is incomplete.'
    : `HeatShield classifies this report as ${priority} priority using verified thermal evidence, selected-day exposure behavior and registered enterprise asset context. This is a HeatShield interpretation, not a FortyGuard risk score.`

  return {
    id: `enterprise-report-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    template,
    title: `${site.name} ${templateLabel(template)} Heat Risk Report`,
    site: { id: site.id, name: site.name, address: site.address },
    controls: { completedDay, thresholdC, granularityMeters: granularity },
    evidence: {
      state: evidenceState,
      latestThermalStatus: thermal?.dataStatus ?? 'unavailable',
      latestObservedAt: thermal?.observedAt ?? null,
      peakTemperatureC: thermal?.maxTemperatureC ?? null,
      meanTemperatureC: thermal?.meanTemperatureC ?? null,
      tileCount: thermal?.tileCount ?? 0,
      historicalStatus: history?.dataStatus ?? 'unavailable',
      maxPersistenceHours: history?.maxPersistenceHours ?? null,
      meanExceedanceHours: history?.meanExceedanceHours ?? null,
      commonPeakPeriodLocal: history?.commonPeakPeriodLocal ?? history?.commonPeakHourLocal ?? null,
      providerRequestCount: history?.providerRequestCount ?? 0,
      conditionSource,
      fallbackActive: intelligence?.fallbackActive ?? false,
    },
    assets: {
      total: assets.length,
      businessCritical,
      matched,
      coolingDependent,
      heatLimitBreaches,
      findings: assetFindings,
    },
    analysis: {
      priority,
      headline: priorityHeadline(priority),
      summary,
      findings,
      actions,
    },
    provenance: [
      { label: 'Latest surface temperature', source: 'FortyGuard Heatmap / TCM', status: thermalVerified ? 'Verified' : 'Unavailable' },
      { label: 'Daily exposure behavior', source: 'FortyGuard Exceedance / Persistence / Peak Time', status: historyVerified ? (history?.dataStatus === 'verified' ? 'Verified' : 'Partial') : 'Unavailable' },
      { label: 'Atmospheric context', source: conditionSource ?? 'No current source', status: intelligence?.conditions ? (intelligence.fallbackActive ? 'Context / fallback' : 'Available') : 'Unavailable' },
      { label: 'Asset registry', source: 'HeatShield Enterprise', status: assets.length ? `${assets.length} registered` : 'No assets registered' },
      { label: 'Priority and recommendations', source: 'HeatShield derived analysis', status: priority === 'unassessed' ? 'Withheld' : 'Derived' },
    ],
  }
}

function readSavedReports(): EnterpriseHeatRiskReport[] {
  try {
    const raw = localStorage.getItem(REPORT_LIBRARY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as EnterpriseHeatRiskReport[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function downloadJson(report: EnterpriseHeatRiskReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `heatshield-${report.site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${report.controls.completedDay}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function EnterpriseHeatRiskReportsPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [template, setTemplate] = useState<EnterpriseReportTemplate>('executive')
  const [analysisDate, setAnalysisDate] = useState(defaultAnalysisDate)
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [report, setReport] = useState<EnterpriseHeatRiskReport | null>(null)
  const [savedReports, setSavedReports] = useState<EnterpriseHeatRiskReport[]>([])
  const [loadingSites, setLoadingSites] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runWarnings, setRunWarnings] = useState<string[]>([])

  useEffect(() => {
    setSavedReports(readSavedReports())
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = stored && loaded.some((site) => site.id === stored) ? stored : loaded[0]?.id ?? null
        setSelectedSiteId(preferred)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load enterprise sites.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSites(false)
      })
    return () => controller.abort()
  }, [])

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites])
  const maxDate = localDateString(new Date())

  const runReport = async () => {
    if (!selectedSite || running) return
    setRunning(true)
    setError(null)
    setRunWarnings([])
    localStorage.setItem(STORAGE_KEY, selectedSite.id)
    try {
      const results = await Promise.allSettled([
        api.listEnterpriseAssets(selectedSite.id),
        api.getSiteIntelligence(selectedSite.id),
        api.generateThermalMap(selectedSite.id, { mode: 'site', granularityMeters: granularity }),
        api.generateHistoricalHeatBehavior(selectedSite.id, {
          startDate: analysisDate,
          endDate: analysisDate,
          thresholdF: celsiusToFahrenheit(thresholdC),
          granularityMeters: granularity,
        }),
      ])

      const warnings: string[] = []
      const labels = ['Asset registry', 'Site context', 'Latest FortyGuard thermal layer', 'Selected-day FortyGuard history']
      results.forEach((result, index) => {
        if (result.status === 'rejected') warnings.push(`${labels[index]}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`)
      })

      const assets = results[0].status === 'fulfilled' ? results[0].value : []
      const intelligence = results[1].status === 'fulfilled' ? results[1].value : null
      const thermal = results[2].status === 'fulfilled' ? results[2].value : null
      const history = results[3].status === 'fulfilled' ? results[3].value : null
      if (thermal && thermal.dataStatus !== 'verified' && thermal.message) warnings.push(thermal.message)
      if (history && ['unavailable', 'configuration_required'].includes(history.dataStatus) && history.message) warnings.push(history.message)

      setRunWarnings(warnings)
      setReport(buildReport(selectedSite, template, analysisDate, thresholdC, granularity, assets, intelligence, thermal, history))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to build enterprise heat risk report.')
    } finally {
      setRunning(false)
    }
  }

  const saveSnapshot = () => {
    if (!report) return
    const next = [report, ...savedReports.filter((item) => item.id !== report.id)].slice(0, 20)
    setSavedReports(next)
    localStorage.setItem(REPORT_LIBRARY_KEY, JSON.stringify(next))
  }

  const removeSnapshot = (id: string) => {
    const next = savedReports.filter((item) => item.id !== id)
    setSavedReports(next)
    localStorage.setItem(REPORT_LIBRARY_KEY, JSON.stringify(next))
  }

  return (
    <AppShell module="enterprise">
      <header className="enterprise-report-topbar">
        <div><h1>Heat Risk Reports</h1><span>Generate auditable enterprise evidence packages without mixing provider measurements and HeatShield recommendations.</span></div>
        <div className="enterprise-report-topbar__spacer" />
        <div className="enterprise-report-core"><span /><div><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard evidence core</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="enterprise-report-page">
        {loadingSites && <StatePanel kind="loading" title="Loading report workspace" detail="Reading enterprise sites and saved report snapshots…" />}
        {!loadingSites && !sites.length && <StatePanel kind="empty" title="No enterprise sites available" detail="Create an Enterprise site before generating a heat risk report." />}

        {!loadingSites && sites.length > 0 && (
          <>
            <section className="enterprise-report-hero">
              <div><span className="enterprise-report-eyebrow">EVIDENCE → DECISION → AUDIT</span><h2>Enterprise Heat Risk Report Builder</h2><p>Build a point-in-time report from the same site geometry, FortyGuard thermal layers and registered asset context used across the Enterprise module.</p></div>
              <div className="enterprise-report-actions">
                <button type="button" className="button button--secondary" disabled={!report} onClick={saveSnapshot}><Save size={16} /> Save Snapshot</button>
                <button type="button" className="button button--secondary" disabled={!report} onClick={() => report && downloadJson(report)}><Download size={16} /> Export JSON</button>
                <button type="button" className="button button--primary" disabled={!report} onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
              </div>
            </section>

            <section className="enterprise-report-builder panel">
              <label><span>Site</span><div><Building2 size={15} /><select value={selectedSiteId ?? ''} onChange={(event) => setSelectedSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div></label>
              <label><span>Report template</span><div><FileText size={15} /><select value={template} onChange={(event) => setTemplate(event.target.value as EnterpriseReportTemplate)}><option value="executive">Executive</option><option value="property">Property Exposure</option><option value="assets">Asset Risk</option><option value="industrial">Industrial / Data Center</option></select></div></label>
              <label><span>Completed day</span><div><CalendarDays size={15} /><input type="date" min="2021-01-01" max={maxDate} value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} /></div></label>
              <label><span>Heat threshold</span><div><ThermometerSun size={15} /><input type="number" min="20" max="55" step="0.5" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /><b>°C</b></div></label>
              <label><span>Resolution</span><div><Database size={15} /><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as Granularity)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></div></label>
              <button type="button" className="button button--primary" onClick={() => void runReport()} disabled={running}>{running ? <RefreshCw size={16} className="spin" /> : <BarChart3 size={16} />}{running ? 'Generating…' : 'Generate Report'}</button>
            </section>

            <div className="enterprise-report-policy"><ShieldCheck size={15} /><span><strong>Evidence policy:</strong> FortyGuard measurements are preserved as provider evidence. HeatShield priority, findings and recommendations are clearly labelled as derived analysis.</span></div>
            {error && <div className="enterprise-report-warning"><AlertTriangle size={15} /> {error}</div>}
            {runWarnings.length > 0 && <div className="enterprise-report-warning"><AlertTriangle size={15} /><span>{runWarnings.join(' ')}</span></div>}

            <div className="enterprise-report-workspace">
              <aside className="enterprise-report-library panel">
                <div className="enterprise-report-section-head"><div><span>REPORT LIBRARY</span><h2>Saved Snapshots</h2><p>Stored in this browser. Server-side report persistence is not configured.</p></div><Archive size={19} /></div>
                {!savedReports.length ? <div className="enterprise-report-library__empty"><FileText size={24} /><strong>No saved reports</strong><span>Generate and save an evidence snapshot to keep it here.</span></div> : (
                  <div className="enterprise-report-library__list">
                    {savedReports.map((item) => <article key={item.id} className={report?.id === item.id ? 'selected' : ''}><button type="button" onClick={() => setReport(item)}><span>{templateLabel(item.template)}</span><strong>{item.site.name}</strong><small>{item.controls.completedDay} · {formatDateTime(item.generatedAt)}</small><i className={`enterprise-report-priority ${item.analysis.priority}`}>{item.analysis.priority}</i></button><button type="button" className="enterprise-report-library__remove" onClick={() => removeSnapshot(item.id)} aria-label={`Remove ${item.title}`}>×</button></article>)}
                  </div>
                )}
              </aside>

              <section className="enterprise-report-preview panel">
                {!report ? (
                  <div className="enterprise-report-preview__empty"><FileText size={34} /><h2>No report generated yet</h2><p>Select a site and completed day, then generate the evidence package. HeatShield will not prefill fake measurements.</p></div>
                ) : (
                  <div className="enterprise-report-document">
                    <header className="enterprise-report-document__header">
                      <div><span>HEATSHIELD ENTERPRISE</span><h1>{report.title}</h1><p>{report.site.address}</p></div>
                      <div><span>Generated</span><strong>{formatDateTime(report.generatedAt)}</strong><small>{templateLabel(report.template)} template</small></div>
                    </header>

                    <section className="enterprise-report-summary">
                      <div><span>HEATSHIELD DERIVED PRIORITY</span><strong className={`enterprise-report-priority ${report.analysis.priority}`}>{report.analysis.priority}</strong><h2>{report.analysis.headline}</h2><p>{report.analysis.summary}</p></div>
                      <dl><div><dt>Completed day</dt><dd>{report.controls.completedDay}</dd></div><div><dt>Threshold</dt><dd>{report.controls.thresholdC.toFixed(1)}°C</dd></div><div><dt>Resolution</dt><dd>{report.controls.granularityMeters} m</dd></div><div><dt>Evidence completeness</dt><dd>{report.evidence.state}</dd></div></dl>
                    </section>

                    <section className="enterprise-report-block">
                      <div className="enterprise-report-block__head"><div><span>VERIFIED PROVIDER EVIDENCE</span><h2>FortyGuard Thermal Evidence</h2></div><ShieldCheck size={20} /></div>
                      <div className="enterprise-report-metrics"><article><span>Peak surface</span><strong>{temperature(report.evidence.peakTemperatureC)}</strong><small>{report.evidence.latestObservedAt ? formatDateTime(report.evidence.latestObservedAt) : 'Latest verified timestamp unavailable'}</small></article><article><span>Mean surface</span><strong>{temperature(report.evidence.meanTemperatureC)}</strong><small>{report.evidence.tileCount} returned TCM cells</small></article><article><span>Max persistence</span><strong>{hours(report.evidence.maxPersistenceHours)}</strong><small>Selected completed day</small></article><article><span>Mean exceedance</span><strong>{hours(report.evidence.meanExceedanceHours)}</strong><small>Above {report.controls.thresholdC.toFixed(1)}°C</small></article><article><span>Common peak</span><strong>{report.evidence.commonPeakPeriodLocal ?? '—'}</strong><small>Local exposure period</small></article><article><span>Historical status</span><strong>{report.evidence.historicalStatus}</strong><small>{report.evidence.providerRequestCount} provider requests returned</small></article></div>
                    </section>

                    <section className="enterprise-report-block">
                      <div className="enterprise-report-block__head"><div><span>ENTERPRISE CONTEXT</span><h2>Registered Infrastructure</h2></div><Box size={20} /></div>
                      <div className="enterprise-report-asset-summary"><article><strong>{report.assets.total}</strong><span>Registered assets</span></article><article><strong>{report.assets.businessCritical}</strong><span>High / critical business assets</span></article><article><strong>{report.assets.matched}/{report.assets.total || 0}</strong><span>Assets matched to evidence</span></article><article><strong>{report.assets.coolingDependent}</strong><span>Cooling-dependent assets</span></article><article className={report.assets.heatLimitBreaches ? 'alert' : ''}><strong>{report.assets.heatLimitBreaches}</strong><span>Configured limit breaches</span></article></div>
                      {report.assets.findings.length > 0 && <div className="enterprise-report-asset-table-wrap"><table><thead><tr><th>Asset</th><th>Criticality</th><th>Latest Surface</th><th>Exceedance</th><th>Persistence</th><th>Evidence</th></tr></thead><tbody>{report.assets.findings.slice(0, 10).map((item) => <tr key={item.assetId}><td><strong>{item.name}</strong><small>{item.assetCode} · {item.type.replaceAll('_', ' ')}</small></td><td>{item.criticality}</td><td className={item.heatLimitExceeded ? 'breach' : ''}>{temperature(item.latestTemperatureC)}{item.heatLimitC != null && <small>Limit {item.heatLimitC.toFixed(1)}°C</small>}</td><td>{hours(item.exceedanceHours)}</td><td>{hours(item.persistenceHours)}</td><td><span className={`enterprise-report-evidence-pill ${item.evidenceMatched ? 'matched' : 'unmatched'}`}>{item.evidenceMatched ? 'Matched' : 'Unmatched'}</span></td></tr>)}</tbody></table></div>}
                    </section>

                    <section className="enterprise-report-two-column">
                      <div className="enterprise-report-block"><div className="enterprise-report-block__head"><div><span>HEATSHIELD ANALYSIS</span><h2>Key Findings</h2></div><BarChart3 size={20} /></div><ol>{report.analysis.findings.map((finding) => <li key={finding}>{finding}</li>)}</ol></div>
                      <div className="enterprise-report-block"><div className="enterprise-report-block__head"><div><span>DECISION SUPPORT</span><h2>Recommended Reviews</h2></div><Factory size={20} /></div><ol>{report.analysis.actions.map((action) => <li key={action}>{action}</li>)}</ol></div>
                    </section>

                    <section className="enterprise-report-block enterprise-report-provenance">
                      <div className="enterprise-report-block__head"><div><span>AUDIT TRAIL</span><h2>Evidence Provenance</h2></div><CheckCircle2 size={20} /></div>
                      <div className="enterprise-report-provenance__grid">{report.provenance.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.source}</strong><small>{item.status}</small></article>)}</div>
                      {report.evidence.fallbackActive && <div className="enterprise-report-fallback-note"><AlertTriangle size={16} /><span>Atmospheric context is using fallback data. It is not represented as FortyGuard spatial thermal evidence.</span></div>}
                    </section>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </AppShell>
  )
}
