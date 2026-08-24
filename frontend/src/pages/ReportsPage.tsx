import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FileBarChart,
  FileCheck2,
  History,
  LoaderCircle,
  Printer,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { HistoricalHeatBehaviorResponse } from '../types/history'
import type { OperationalApproval, Site, SiteIntelligence, Worker } from '../types/site'
import type {
  HistoricalReportSummary,
  WorkforceReportEvidenceStatus,
  WorkforceReportSnapshot,
  WorkforceReportType,
} from '../types/workforce-report'

const STORAGE_KEY = 'heatshield:selected-site'
const REPORT_LIBRARY_KEY = 'heatshield:workforce-report-library:v2'
const MAX_LIBRARY_ITEMS = 12

type HistoryDays = 7 | 14 | 30

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function historicalRange(days: number) {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  return { startDate: localDateString(start), endDate: localDateString(end) }
}

function celsiusToFahrenheit(value: number) {
  return value * 9 / 5 + 32
}

function formatTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function temp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function sourceLabel(data: SiteIntelligence) {
  if (data.conditionSource === 'fortyguard') return 'FortyGuard'
  if (data.conditionSource === 'nws') return 'National Weather Service'
  return 'No verified atmospheric source'
}

function titleFor(type: WorkforceReportType, worker?: Worker | null) {
  if (type === 'worker_exposure') return worker ? `Worker Exposure Report — ${worker.name}` : 'Worker Exposure Report'
  if (type === 'historical_site') return 'Historical Site Heat Report'
  return 'Daily Heat Operations Report'
}

function typeLabel(type: WorkforceReportType) {
  if (type === 'worker_exposure') return 'Worker Exposure'
  if (type === 'historical_site') return 'Historical Site'
  return 'Daily Operations'
}

function evidenceLabel(status: WorkforceReportEvidenceStatus) {
  if (status === 'verified') return 'Verified evidence'
  if (status === 'partial') return 'Partial evidence'
  return 'Limited evidence'
}

function compactHistorical(result: HistoricalHeatBehaviorResponse): HistoricalReportSummary {
  return {
    startDate: result.startDate,
    endDate: result.endDate,
    dayCount: result.dayCount,
    thresholdC: result.thresholdC,
    thresholdF: result.thresholdF,
    granularityMeters: result.granularityMeters,
    dataStatus: result.dataStatus,
    providerRequestCount: result.providerRequestCount,
    cellCount: result.cellCount,
    meanTemperatureC: result.meanTemperatureC,
    minTemperatureC: result.minTemperatureC,
    maxTemperatureC: result.maxTemperatureC,
    meanExceedanceHours: result.meanExceedanceHours,
    maxExceedanceHours: result.maxExceedanceHours,
    meanPersistenceHours: result.meanPersistenceHours,
    maxPersistenceHours: result.maxPersistenceHours,
    commonPeakPeriodLocal: result.commonPeakPeriodLocal,
    generatedAt: result.generatedAt,
    layers: result.layers,
    topZones: result.zones.slice(0, 5),
  }
}

function evidenceStatus(
  type: WorkforceReportType,
  intelligence: SiteIntelligence,
  historical: HistoricalReportSummary | null,
  historicalRequested: boolean,
): WorkforceReportEvidenceStatus {
  const currentVerified = Boolean(intelligence.conditions)
    && intelligence.conditionSource === 'fortyguard'
    && (intelligence.thermalStatus === 'verified' || intelligence.thermalStatus === 'recent_verified')
  const currentAvailable = Boolean(intelligence.conditions)

  if (type === 'historical_site') {
    if (historical?.dataStatus === 'verified') return 'verified'
    if (historical?.dataStatus === 'partial') return 'partial'
    return 'limited'
  }
  if (historicalRequested) {
    if (currentVerified && historical?.dataStatus === 'verified') return 'verified'
    if (currentAvailable || historical?.dataStatus === 'verified' || historical?.dataStatus === 'partial') return 'partial'
    return 'limited'
  }
  if (currentVerified) return 'verified'
  if (currentAvailable) return 'partial'
  return 'limited'
}

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `report-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readLibrary(): WorkforceReportSnapshot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORT_LIBRARY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function approvalTarget(approval: OperationalApproval, snapshot: WorkforceReportSnapshot) {
  if (approval.choice === 'better_time') return approval.targetTime ? formatTime(approval.targetTime) : 'Future time window'
  if (approval.choice === 'better_place') {
    return snapshot.intelligence.site.zones.find((zone) => zone.id === approval.targetZoneId)?.name ?? 'Approved zone'
  }
  return 'Current assignment'
}

function sameUtcDay(value: string, reference = new Date()) {
  const date = new Date(value)
  return date.getUTCFullYear() === reference.getUTCFullYear()
    && date.getUTCMonth() === reference.getUTCMonth()
    && date.getUTCDate() === reference.getUTCDate()
}

export function ReportsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [reportType, setReportType] = useState<WorkforceReportType>('daily_operations')
  const [workerId, setWorkerId] = useState('')
  const [includeHistorical, setIncludeHistorical] = useState(false)
  const [historyDays, setHistoryDays] = useState<HistoryDays>(30)
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loadingWorkers, setLoadingWorkers] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<WorkforceReportSnapshot | null>(null)
  const [library, setLibrary] = useState<WorkforceReportSnapshot[]>(() => readLibrary())

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSites(loaded)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && loaded.some((site) => site.id === id)) ?? loaded[0]?.id ?? null
        setSiteId(preferred)
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load sites.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingSites(false) })
    return () => controller.abort()
    // initial route preference only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!siteId) {
      setWorkers([])
      setWorkerId('')
      return
    }
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    const controller = new AbortController()
    setLoadingWorkers(true)
    setReport((current) => current && current.siteId === siteId ? current : null)
    setError(null)
    api.listWorkers(siteId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setWorkers(loaded)
        setWorkerId((current) => loaded.some((worker) => worker.id === current) ? current : loaded[0]?.id ?? '')
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load workers.') })
      .finally(() => { if (!controller.signal.aborted) setLoadingWorkers(false) })
    return () => controller.abort()
  }, [siteId, setSearchParams])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const selectedWorker = workers.find((worker) => worker.id === workerId) ?? null
  const historicalRequired = reportType === 'historical_site' || includeHistorical

  const generateReport = async () => {
    if (!siteId || !selectedSite) return
    if (reportType === 'worker_exposure' && !workerId) {
      setError('Select a worker before generating a Worker Exposure Report.')
      return
    }
    if (!Number.isFinite(thresholdC) || thresholdC < -30 || thresholdC > 70) {
      setError('Historical heat threshold must be between -30°C and 70°C.')
      return
    }

    setGenerating(true)
    setError(null)
    try {
      const intelligencePromise = api.getSiteIntelligence(siteId)
      const approvalsPromise = api.listOperationalApprovals(siteId)
      const historicalPromise = historicalRequired
        ? api.generateHistoricalHeatBehavior(siteId, {
            ...historicalRange(historyDays),
            thresholdF: celsiusToFahrenheit(thresholdC),
            granularityMeters: granularity,
          })
        : Promise.resolve(null)

      const [intelligence, approvals, historicalResult] = await Promise.all([
        intelligencePromise,
        approvalsPromise,
        historicalPromise,
      ])
      const worker = intelligence.workers.find((item) => item.id === workerId) ?? selectedWorker
      const historical = historicalResult ? compactHistorical(historicalResult) : null
      const relevantApprovals = reportType === 'historical_site'
        ? []
        : reportType === 'worker_exposure'
          ? approvals.filter((approval) => approval.workerId === workerId)
          : approvals.filter((approval) => sameUtcDay(approval.createdAt))
      const snapshot: WorkforceReportSnapshot = {
        id: makeId(),
        type: reportType,
        title: titleFor(reportType, worker),
        generatedAt: new Date().toISOString(),
        siteId,
        siteName: selectedSite.name,
        siteAddress: selectedSite.address,
        evidenceStatus: evidenceStatus(reportType, intelligence, historical, historicalRequired),
        workerId: reportType === 'worker_exposure' ? workerId : null,
        intelligence,
        approvals: relevantApprovals,
        historical,
        historicalRequested: historicalRequired,
      }
      setReport(snapshot)
    } catch (err) {
      setReport(null)
      setError(err instanceof Error ? err.message : 'Could not generate the workforce heat report.')
    } finally {
      setGenerating(false)
    }
  }

  const saveReport = () => {
    if (!report) return
    const next = [report, ...library.filter((item) => item.id !== report.id)].slice(0, MAX_LIBRARY_ITEMS)
    setLibrary(next)
    localStorage.setItem(REPORT_LIBRARY_KEY, JSON.stringify(next))
  }

  const removeSavedReport = (id: string) => {
    const next = library.filter((item) => item.id !== id)
    setLibrary(next)
    localStorage.setItem(REPORT_LIBRARY_KEY, JSON.stringify(next))
    if (report?.id === id) setReport(null)
  }

  const openSavedReport = (item: WorkforceReportSnapshot) => {
    setReport(item)
    setSiteId(item.siteId)
  }

  const changeSite = (nextId: string) => {
    setReport(null)
    setSiteId(nextId)
  }

  const downloadCsv = () => {
    if (!report) return
    const currentWorker = report.workerId
      ? report.intelligence.workers.find((worker) => worker.id === report.workerId)
      : null
    const rows: unknown[][] = [
      ['HeatShield Workforce Heat Report'],
      ['Report Type', typeLabel(report.type)],
      ['Report ID', report.id],
      ['Generated At', report.generatedAt],
      ['Evidence Status', evidenceLabel(report.evidenceStatus)],
      ['Site', report.siteName],
      ['Address', report.siteAddress],
      ['Condition Source', sourceLabel(report.intelligence)],
      ['Observed At', report.intelligence.observedAt ?? ''],
      ['Thermal Status', report.intelligence.thermalStatus],
      ['Temperature C', report.intelligence.conditions?.temperatureC ?? ''],
      ['Heat Index C', report.intelligence.conditions?.heatIndexC ?? ''],
      ['Humidity %', report.intelligence.conditions?.humidityPercent ?? ''],
    ]
    if (currentWorker) {
      rows.push([], ['Worker', currentWorker.name], ['Role', currentWorker.role], ['Task', currentWorker.task ?? ''], ['Risk', currentWorker.risk])
    } else {
      rows.push([], ['Worker', 'Role', 'Task', 'Area', 'Risk', 'Work Intensity', 'Sun', 'Shade', 'Water'])
      report.intelligence.workers.forEach((worker) => rows.push([
        worker.name, worker.role, worker.task ?? '', worker.location, worker.risk,
        worker.workIntensity ?? '', worker.sunExposure ?? '', worker.shadeAccess ?? '',
        worker.waterAccess == null ? '' : worker.waterAccess ? 'Yes' : 'No',
      ]))
    }
    rows.push([], ['Supervisor Decisions'])
    rows.push(['Created', 'Worker', 'Choice', 'Target', 'Expected Reduction C', 'Status', 'Verified Temperature C', 'Actual Reduction C'])
    report.approvals.forEach((approval) => {
      const worker = report.intelligence.workers.find((item) => item.id === approval.workerId)
      rows.push([
        approval.createdAt,
        worker?.name ?? approval.workerId,
        approval.choice,
        approvalTarget(approval, report),
        approval.expectedReductionC ?? '',
        approval.status,
        approval.verifiedTemperatureC ?? '',
        approval.actualReductionC ?? '',
      ])
    })
    if (report.historical) {
      rows.push([], ['Historical Context'])
      rows.push(
        ['Start', report.historical.startDate],
        ['End', report.historical.endDate],
        ['Threshold C', report.historical.thresholdC],
        ['Mean Temperature C', report.historical.meanTemperatureC ?? ''],
        ['Max Temperature C', report.historical.maxTemperatureC ?? ''],
        ['Max Exceedance Hours', report.historical.maxExceedanceHours ?? ''],
        ['Max Persistence Hours', report.historical.maxPersistenceHours ?? ''],
        ['Typical Peak', report.historical.commonPeakPeriodLocal ?? ''],
      )
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${report.siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${report.type}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const reportSaved = report ? library.some((item) => item.id === report.id) : false

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId}
        observedAt={report?.intelligence.observedAt}
        onSiteChange={changeSite}
        pageTitle="Workforce Heat Reports"
        pageSubtitle="Turn verified heat evidence, worker context, supervisor decisions and historical site intelligence into an auditable operational record."
        showAddSite={false}
      />

      <main className="wfr-page">
        {loadingSites ? <StatePanel kind="loading" title="Loading report workspace" detail="Reading available work sites…" /> : !sites.length ? (
          <section className="wfr-empty panel"><FileCheck2 size={32} /><div><h2>No reportable site yet</h2><p>Create a site and add operational context before generating a workforce heat report.</p></div><button className="button button--primary" onClick={() => navigate('/')}>Create Site</button></section>
        ) : <>
          <section className="wfr-hero">
            <div>
              <span className="wfr-eyebrow">WORKFORCE EVIDENCE &amp; AUDIT</span>
              <h1>Reports that show what HeatShield knew, recommended and verified.</h1>
              <p>Build evidence-bound operational records without converting unavailable provider data into claims. Current conditions, worker context, supervisor decisions and historical evidence remain visibly separated.</p>
            </div>
            <div className="wfr-hero__trust"><ShieldCheck size={22} /><div><span>REPORT POLICY</span><strong>Evidence first · no fabricated observations</strong><small>FortyGuard and fallback evidence are labeled independently.</small></div></div>
          </section>

          <section className="wfr-builder panel">
            <div className="wfr-builder__head"><div><span className="wfr-eyebrow">REPORT BUILDER</span><h2>Create an operational record</h2></div><span>{selectedSite?.name}</span></div>
            <div className="wfr-builder__grid">
              <label><span>Report type</span><select value={reportType} onChange={(event) => { const next = event.target.value as WorkforceReportType; setReportType(next); if (next === 'historical_site') setIncludeHistorical(true); setReport(null) }}><option value="daily_operations">Daily Heat Operations</option><option value="worker_exposure">Worker Exposure</option><option value="historical_site">Historical Site Heat</option></select><small>Choose the operational question this record should answer.</small></label>

              {reportType === 'worker_exposure' ? <label><span>Worker</span><select value={workerId} disabled={loadingWorkers || !workers.length} onChange={(event) => { setWorkerId(event.target.value); setReport(null) }}>{workers.map((worker) => <option value={worker.id} key={worker.id}>{worker.name} · {worker.role}</option>)}</select><small>{workers.length ? 'Focus the report on one saved worker.' : 'Add a worker before using this report type.'}</small></label> : <label><span>Worker scope</span><div className="wfr-static-field"><UsersRound size={15} /><strong>All workers at selected site</strong></div><small>{workers.length} saved worker profile{workers.length === 1 ? '' : 's'}.</small></label>}

              <label><span>Historical context</span><div className="wfr-toggle-field"><button type="button" className={historicalRequired ? 'active' : ''} disabled={reportType === 'historical_site'} onClick={() => { setIncludeHistorical((value) => !value); setReport(null) }}>{historicalRequired ? 'Included' : 'Not included'}</button><strong>{reportType === 'historical_site' ? 'Required' : historicalRequired ? 'Adds FortyGuard archive evidence' : 'No archive jobs'}</strong></div><small>{historicalRequired ? 'Historical analysis can use up to 4 provider jobs.' : 'Keeps this report focused on current operational evidence.'}</small></label>

              {historicalRequired && <>
                <label><span>History window</span><select value={historyDays} onChange={(event) => { setHistoryDays(Number(event.target.value) as HistoryDays); setReport(null) }}><option value={7}>Last 7 completed days</option><option value={14}>Last 14 completed days</option><option value={30}>Last 30 completed days</option></select><small>Ends yesterday to avoid presenting an incomplete current day as history.</small></label>
                <label><span>Heat threshold</span><div className="wfr-number-field"><input type="number" min={-30} max={70} step={0.5} value={thresholdC} onChange={(event) => { setThresholdC(Number(event.target.value)); setReport(null) }} /><b>°C</b></div><small>Used only for historical exceedance and persistence.</small></label>
                <label><span>Spatial resolution</span><select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value) as 60 | 80 | 100); setReport(null) }}><option value={60}>60 m · detailed</option><option value={80}>80 m · balanced</option><option value={100}>100 m · efficient</option></select><small>Applies to FortyGuard historical cells.</small></label>
              </>}

              <button className="button button--primary wfr-generate" type="button" disabled={generating || !siteId || (reportType === 'worker_exposure' && !workerId)} onClick={() => void generateReport()}>{generating ? <LoaderCircle className="wfr-spin" size={17} /> : <FileBarChart size={17} />}{generating ? 'Building evidence report…' : 'Generate Report'}</button>
            </div>
          </section>

          <div className="wfr-workspace">
            <aside className="wfr-library panel">
              <div className="wfr-library__head"><div><span className="wfr-eyebrow">REPORT LIBRARY</span><h2>Saved records</h2></div><Archive size={18} /></div>
              <p className="wfr-library__note">Saved locally in this browser for demo continuity. Provider measurements remain unchanged inside each saved snapshot.</p>
              {!library.length ? <div className="wfr-library__empty"><Archive size={24} /><strong>No saved reports</strong><span>Generate a report and save the evidence snapshot when it is ready.</span></div> : <div className="wfr-library__list">{library.map((item) => <article className={report?.id === item.id ? 'selected' : ''} key={item.id}><button type="button" onClick={() => openSavedReport(item)}><span>{typeLabel(item.type)}</span><strong>{item.siteName}</strong><small>{formatTime(item.generatedAt)}</small><em className={`wfr-evidence-pill wfr-evidence-pill--${item.evidenceStatus}`}>{evidenceLabel(item.evidenceStatus)}</em></button><button type="button" className="wfr-library__delete" onClick={() => removeSavedReport(item.id)} title="Remove saved report"><Trash2 size={14} /></button></article>)}</div>}
            </aside>

            <section className="wfr-preview panel">
              {!report ? <div className="wfr-preview__empty"><FileCheck2 size={36} /><h2>Generate an evidence-backed report</h2><p>HeatShield will assemble the selected site's current conditions, saved worker context and supervisor decision log. Historical evidence is requested only when you explicitly include it.</p><div><span><strong>1</strong> Select report type</span><span><strong>2</strong> Choose evidence scope</span><span><strong>3</strong> Generate and review</span></div></div> : <ReportDocument report={report} onSave={saveReport} onDownload={downloadCsv} onPrint={() => window.print()} saved={reportSaved} />}
            </section>
          </div>
        </>}
        {error && <div className="form-error wfr-error">{error}</div>}
      </main>
    </AppShell>
  )
}

function ReportDocument({ report, onSave, onDownload, onPrint, saved }: {
  report: WorkforceReportSnapshot
  onSave: () => void
  onDownload: () => void
  onPrint: () => void
  saved: boolean
}) {
  const workers = report.type === 'worker_exposure'
    ? report.intelligence.workers.filter((worker) => worker.id === report.workerId)
    : report.intelligence.workers
  const activeWorkers = workers.filter((worker) => worker.status !== 'offsite')
  const highExposure = activeWorkers.filter((worker) => worker.risk === 'high' || worker.risk === 'extreme').length
  const verifiedApprovals = report.approvals.filter((approval) => approval.status === 'verified').length
  const targetWorker = workers[0] ?? null
  const historical = report.historical

  const summary = report.type === 'historical_site'
    ? historical
      ? `${report.siteName} was analyzed across ${historical.dayCount} completed day${historical.dayCount === 1 ? '' : 's'} using ${historical.cellCount} matched historical cell${historical.cellCount === 1 ? '' : 's'}. The most common verified peak window was ${historical.commonPeakPeriodLocal ?? 'not available'} and the highest matched temperature was ${temp(historical.maxTemperatureC)}.`
      : 'Historical evidence was requested but no usable historical summary is available for this report.'
    : report.type === 'worker_exposure'
      ? targetWorker
        ? `${targetWorker.name} is recorded as ${targetWorker.risk} exposure for ${targetWorker.task ?? targetWorker.role} in ${targetWorker.location}. ${report.approvals.length} supervisor decision${report.approvals.length === 1 ? '' : 's'} are attached to this worker record, with ${verifiedApprovals} verified by a fresh FortyGuard check.`
        : 'The selected worker is no longer present in the saved site snapshot.'
      : `${activeWorkers.length} active worker${activeWorkers.length === 1 ? '' : 's'} are included. ${highExposure} currently carry high or extreme recorded exposure, and ${report.approvals.length} supervisor decision${report.approvals.length === 1 ? '' : 's'} from the current UTC day are present in the audit log, including ${verifiedApprovals} fresh verification${verifiedApprovals === 1 ? '' : 's'}.`

  return <article className="wfr-document">
    <header className="wfr-document__header">
      <div><span className="wfr-document__brand">HEATSHIELD AI · WORKFORCE SAFETY</span><h1>{report.title}</h1><p>{report.siteName} · {report.siteAddress}</p></div>
      <div className="wfr-document__meta"><em className={`wfr-evidence-pill wfr-evidence-pill--${report.evidenceStatus}`}><ShieldCheck size={13} /> {evidenceLabel(report.evidenceStatus)}</em><span>Report ID</span><strong>{report.id.slice(0, 18)}</strong><small>Generated {formatTime(report.generatedAt)}</small></div>
    </header>

    <div className="wfr-document__actions"><button type="button" className="button button--secondary" onClick={onSave} disabled={saved}><Save size={15} /> {saved ? 'Saved' : 'Save Report'}</button><button type="button" className="button button--secondary" onClick={onDownload}><Download size={15} /> Download CSV</button><button type="button" className="button button--primary" onClick={onPrint}><Printer size={15} /> Print / Save PDF</button></div>

    <section className="wfr-summary">
      <div><span className="wfr-section-label">EXECUTIVE SUMMARY</span><h2>Operational interpretation</h2><p>{summary}</p></div>
      <dl><div><dt>Report type</dt><dd>{typeLabel(report.type)}</dd></div><div><dt>Evidence status</dt><dd>{evidenceLabel(report.evidenceStatus)}</dd></div><div><dt>Observation source</dt><dd>{sourceLabel(report.intelligence)}</dd></div><div><dt>Supervisor decisions</dt><dd>{report.approvals.length}</dd></div></dl>
    </section>

    <section className="wfr-block">
      <div className="wfr-block__head"><div><span className="wfr-section-label">ENVIRONMENTAL EVIDENCE</span><h2>Condition snapshot</h2></div><span>{formatTime(report.intelligence.observedAt)}</span></div>
      <div className="wfr-metrics">
        <article><span>Temperature</span><strong>{temp(report.intelligence.conditions?.temperatureC)}</strong><small>{sourceLabel(report.intelligence)}</small></article>
        <article><span>Heat Index</span><strong>{temp(report.intelligence.conditions?.heatIndexC)}</strong><small>Atmospheric heat stress context</small></article>
        <article><span>Apparent Temp</span><strong>{temp(report.intelligence.conditions?.feelsLikeC)}</strong><small>Provider/fallback apparent temperature</small></article>
        <article><span>Humidity</span><strong>{report.intelligence.conditions ? `${report.intelligence.conditions.humidityPercent.toFixed(0)}%` : '—'}</strong><small>Relative humidity</small></article>
        <article><span>Thermal Status</span><strong className="wfr-metric-text">{report.intelligence.thermalStatus.replace('_', ' ')}</strong><small>FortyGuard spatial evidence state</small></article>
        <article><span>Fallback</span><strong className="wfr-metric-text">{report.intelligence.fallbackActive ? 'Active' : 'Not active'}</strong><small>{report.intelligence.fallbackActive ? 'Atmospheric fallback is clearly separated' : 'No fallback used'}</small></article>
      </div>
      {report.intelligence.statusMessage && <div className="wfr-evidence-note"><AlertTriangle size={17} /><p>{report.intelligence.statusMessage}</p></div>}
    </section>

    {report.type !== 'historical_site' && <section className="wfr-block">
      <div className="wfr-block__head"><div><span className="wfr-section-label">WORKER EXPOSURE</span><h2>{report.type === 'worker_exposure' ? 'Worker operational context' : 'Crew exposure register'}</h2></div><span>{activeWorkers.length} active</span></div>
      {!workers.length ? <div className="wfr-inline-empty"><UserRound size={20} /><div><strong>No worker context in this snapshot</strong><p>Add or restore the worker record before relying on worker-specific conclusions.</p></div></div> : <div className="wfr-table-wrap"><table><thead><tr><th>Worker</th><th>Task / Area</th><th>Workload</th><th>Sun / Shade</th><th>Water</th><th>Exposure</th></tr></thead><tbody>{workers.map((worker) => <tr key={worker.id}><td><strong>{worker.name}</strong><small>{worker.role}{worker.team ? ` · ${worker.team}` : ''}</small></td><td><strong>{worker.task ?? 'Task not recorded'}</strong><small>{worker.location}</small></td><td>{worker.workIntensity ?? 'Unknown'}</td><td>{worker.sunExposure ?? 'Unknown'} / {worker.shadeAccess ?? 'Unknown'}</td><td>{worker.waterAccess == null ? 'Unknown' : worker.waterAccess ? 'Available' : 'Not confirmed'}</td><td><em className={`wfr-risk wfr-risk--${worker.risk}`}>{worker.risk}</em></td></tr>)}</tbody></table></div>}
    </section>}

    {report.type !== 'historical_site' && <section className="wfr-block">
      <div className="wfr-block__head"><div><span className="wfr-section-label">SUPERVISOR DECISION LOG</span><h2>Recommendation approvals and verification</h2></div><span>{verifiedApprovals}/{report.approvals.length} verified</span></div>
      {!report.approvals.length ? <div className="wfr-inline-empty"><ClipboardCheck size={20} /><div><strong>No supervisor approvals recorded</strong><p>This report does not imply an action was approved when no approval exists in the HeatShield decision log.</p></div></div> : <div className="wfr-decision-log">{report.approvals.map((approval) => {
        const worker = report.intelligence.workers.find((item) => item.id === approval.workerId)
        return <article key={approval.id}><div className="wfr-decision-log__time"><span>{formatTime(approval.createdAt)}</span>{approval.verifiedAt && <small>Verified {formatTime(approval.verifiedAt)}</small>}</div><div className="wfr-decision-log__body"><span>{worker?.name ?? approval.workerId}</span><strong>Supervisor approved {approval.choice.replace('_', ' ')}</strong><p>Target: {approvalTarget(approval, report)}{approval.expectedReductionC != null ? ` · expected reduction ${approval.expectedReductionC.toFixed(1)}°C` : ''}.</p>{approval.verificationMessage && <small>{approval.verificationMessage}</small>}</div><div className="wfr-decision-log__result"><em className={`wfr-approval wfr-approval--${approval.status}`}>{approval.status.replaceAll('_', ' ')}</em><strong>{approval.verifiedTemperatureC != null ? temp(approval.verifiedTemperatureC) : '—'}</strong><small>{approval.actualReductionC != null ? `${approval.actualReductionC.toFixed(1)}°C actual reduction` : 'No verified reduction'}</small></div></article>
      })}</div>}
    </section>}

    {report.historicalRequested && <section className="wfr-block">
      <div className="wfr-block__head"><div><span className="wfr-section-label">HISTORICAL SITE CONTEXT</span><h2>FortyGuard archive evidence</h2></div><span>{historical ? `${formatDate(historical.startDate)} – ${formatDate(historical.endDate)}` : 'Unavailable'}</span></div>
      {!historical ? <div className="wfr-inline-empty"><History size={20} /><div><strong>Historical evidence unavailable</strong><p>No historical summary is attached to this report.</p></div></div> : <>
        <div className="wfr-history-metrics"><article><span>Mean Temperature</span><strong>{temp(historical.meanTemperatureC)}</strong></article><article><span>Hottest Cell</span><strong>{temp(historical.maxTemperatureC)}</strong></article><article><span>Max Exceedance</span><strong>{hours(historical.maxExceedanceHours)}</strong></article><article><span>Max Persistence</span><strong>{hours(historical.maxPersistenceHours)}</strong></article><article><span>Typical Peak</span><strong>{historical.commonPeakPeriodLocal ?? '—'}</strong></article><article><span>Historical Cells</span><strong>{historical.cellCount}</strong></article></div>
        <div className="wfr-history-grid"><div><span className="wfr-section-label">TOP MATCHED ZONES</span>{!historical.topZones.length ? <p>No named site zones matched the historical cells.</p> : historical.topZones.map((zone, index) => <article className="wfr-history-zone" key={zone.zoneId}><span>{index + 1}</span><div><strong>{zone.zoneName}</strong><small>{zone.evidenceStatus} evidence</small></div><div><small>Temperature</small><strong>{temp(zone.temperatureC)}</strong></div><div><small>Above threshold</small><strong>{hours(zone.exceedanceHours)}</strong></div><div><small>Peak</small><strong>{zone.peakHourLocal ?? '—'}</strong></div></article>)}</div><aside><span className="wfr-section-label">HISTORICAL INTERPRETATION</span><p>These values describe the selected historical window and threshold. They are not a claim that today's weather will repeat the same pattern.</p><dl><div><dt>Threshold</dt><dd>{historical.thresholdC.toFixed(1)}°C</dd></div><div><dt>Window</dt><dd>{historical.dayCount} days</dd></div><div><dt>Resolution</dt><dd>{historical.granularityMeters} m</dd></div><div><dt>Provider jobs</dt><dd>{historical.providerRequestCount}</dd></div></dl></aside></div>
      </>}
    </section>}

    <section className="wfr-block wfr-provenance">
      <div className="wfr-block__head"><div><span className="wfr-section-label">EVIDENCE &amp; PROVENANCE</span><h2>What supports this report</h2></div><Database size={18} /></div>
      <div className="wfr-provenance__grid"><article><span>Current conditions</span><strong>{sourceLabel(report.intelligence)}</strong><small>{formatTime(report.intelligence.observedAt)}</small></article><article><span>FortyGuard thermal</span><strong>{report.intelligence.thermalStatus.replace('_', ' ')}</strong><small>{report.intelligence.thermalObservedAt ? formatTime(report.intelligence.thermalObservedAt) : 'No thermal timestamp'}</small></article><article><span>Worker context</span><strong>{report.intelligence.workers.length} saved profile{report.intelligence.workers.length === 1 ? '' : 's'}</strong><small>Task, location, workload and controls are supervisor-entered context.</small></article><article><span>Decision audit</span><strong>{report.approvals.length} approval record{report.approvals.length === 1 ? '' : 's'}</strong><small>{verifiedApprovals} fresh FortyGuard verification{verifiedApprovals === 1 ? '' : 's'}.</small></article>{historical && <article><span>Historical archive</span><strong>{historical.dataStatus} · {historical.cellCount} cells</strong><small>{historical.layers.filter((layer) => layer.status === 'verified').length}/{historical.layers.length} provider layers verified.</small></article>}</div>
      {historical && <div className="wfr-layer-list">{historical.layers.map((layer) => <article key={layer.analyticType}><span className={`wfr-layer-dot wfr-layer-dot--${layer.status}`} /><div><strong>{layer.analyticType.replaceAll('_', ' ')}</strong><small>{layer.status} · {layer.cellCount} cells{layer.activityId ? ` · activity ${layer.activityId}` : ''}</small></div></article>)}</div>}
      <div className="wfr-policy"><CheckCircle2 size={18} /><p><strong>Evidence policy:</strong> HeatShield separates provider-verified measurements, fallback atmospheric context, supervisor-entered worker data and HeatShield-derived interpretation. Missing provider observations are not replaced with invented values.</p></div>
    </section>
  </article>
}
