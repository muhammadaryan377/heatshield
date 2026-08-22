import { AlertTriangle, BarChart3, ClipboardList, CloudSun, Download, Droplets, FileCheck2, Gauge, History, ShieldCheck, Sun, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { HistoricalHeatBehaviorPanel } from '../components/reports/HistoricalHeatBehaviorPanel'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { RiskLevel, Site, SiteIntelligence, Worker } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'
type ReportView = 'snapshot' | 'history'

function riskLabel(level?: RiskLevel | null) {
  if (!level) return 'Pending'
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function sourceLabel(data: SiteIntelligence | null) {
  if (data?.conditionSource === 'fortyguard') return 'FortyGuard'
  if (data?.conditionSource === 'nws') return 'National Weather Service'
  return 'No verified source'
}

function formatTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Verified observation'
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function percent(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0
}

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function ReportsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<ReportView>(searchParams.get('view') === 'history' ? 'history' : 'snapshot')
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string | null>(null)
  const [data, setData] = useState<SiteIntelligence | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    // initial query preference only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!siteId) { setData(null); return }
    localStorage.setItem(STORAGE_KEY, siteId)
    const nextParams: Record<string, string> = { site: siteId }
    if (view === 'history') nextParams.view = 'history'
    setSearchParams(nextParams, { replace: true })

    if (view === 'history') {
      setLoading(false)
      setData(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api.getSiteIntelligence(siteId, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setData(response) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not build report snapshot.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [siteId, view, setSearchParams])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const workers = data?.workers ?? []
  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status !== 'offsite'), [workers])
  const directSun = activeWorkers.filter((worker) => worker.sunExposure === 'direct').length
  const heavyWork = activeWorkers.filter((worker) => worker.workIntensity === 'heavy').length
  const shadeGap = activeWorkers.filter((worker) => worker.shadeAccess === 'none' || worker.shadeAccess === 'limited').length
  const waterGap = activeWorkers.filter((worker) => worker.waterAccess === false).length
  const riskCounts = useMemo(() => ({
    extreme: activeWorkers.filter((worker) => worker.risk === 'extreme').length,
    high: activeWorkers.filter((worker) => worker.risk === 'high').length,
    medium: activeWorkers.filter((worker) => worker.risk === 'medium').length,
    low: activeWorkers.filter((worker) => worker.risk === 'low').length,
  }), [activeWorkers])

  const findings = useMemo(() => {
    if (!data) return [] as { level: 'critical' | 'attention' | 'good'; title: string; detail: string }[]
    const result: { level: 'critical' | 'attention' | 'good'; title: string; detail: string }[] = []
    if (data.highExposureCount > 0) result.push({ level: 'critical', title: `${data.highExposureCount} high-exposure worker${data.highExposureCount === 1 ? '' : 's'}`, detail: 'Review the worker-specific plan before peak exposure continues.' })
    if (shadeGap > 0) result.push({ level: 'attention', title: `${shadeGap} worker${shadeGap === 1 ? '' : 's'} with limited or no shade`, detail: 'Recovery capacity is weaker than the recorded exposure context requires.' })
    if (waterGap > 0) result.push({ level: 'critical', title: `${waterGap} worker${waterGap === 1 ? '' : 's'} without confirmed water access`, detail: 'Resolve water access before approving strenuous outdoor work.' })
    if (directSun > 0) result.push({ level: 'attention', title: `${directSun} worker${directSun === 1 ? '' : 's'} in direct sun`, detail: 'Use task timing and rotation controls when heat risk increases.' })
    if (!result.length) result.push({ level: 'good', title: 'No major recorded exposure gaps', detail: 'Continue routine monitoring and keep worker context current.' })
    return result.slice(0, 4)
  }, [data, directSun, shadeGap, waterGap])

  const exportCsv = () => {
    if (!data) return
    const rows = [
      ['HeatShield Current Operational Snapshot'],
      ['Site', data.site.name],
      ['Address', data.site.address],
      ['Observed At', data.observedAt ?? ''],
      ['Condition Source', sourceLabel(data)],
      ['Thermal Status', data.thermalStatus ?? 'unknown'],
      ['Temperature C', data.conditions?.temperatureC ?? ''],
      ['Humidity %', data.conditions?.humidityPercent ?? ''],
      ['Heat Index C', data.conditions?.heatIndexC ?? ''],
      ['Overall Risk', data.risk?.level ?? 'pending'],
      [],
      ['Worker', 'Role', 'Team', 'Task', 'Location', 'Risk', 'Work Intensity', 'Sun Exposure', 'Shade Access', 'Water Access', 'Shift Start', 'Shift End'],
      ...workers.map((worker) => [worker.name, worker.role, worker.team ?? '', worker.task ?? '', worker.location, worker.risk, worker.workIntensity ?? '', worker.sunExposure ?? '', worker.shadeAccess ?? '', worker.waterAccess == null ? '' : worker.waterAccess, worker.shiftStart ?? '', worker.shiftEnd ?? '']),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `heatshield-${data.site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-snapshot.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId}
        observedAt={view === 'snapshot' ? data?.observedAt : null}
        onSiteChange={setSiteId}
        pageTitle="Reports"
        pageSubtitle={view === 'history' ? 'Understand how each site repeatedly behaves under heat using FortyGuard historical spatial analysis.' : 'Current operational safety snapshot built from verified conditions and saved worker exposure context.'}
        showAddSite={false}
      />

      <div className="reports-page">
        {!loadingSites && sites.length > 0 && (
          <div className="report-view-tabs panel" role="tablist" aria-label="Report type">
            <button type="button" role="tab" aria-selected={view === 'snapshot'} className={view === 'snapshot' ? 'active' : ''} onClick={() => setView('snapshot')}><FileCheck2 size={17} /><span><strong>Current Snapshot</strong><small>What needs attention now</small></span></button>
            <button type="button" role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={17} /><span><strong>Historical Heat Behavior</strong><small>How this site normally behaves</small></span></button>
          </div>
        )}

        {loadingSites ? <StatePanel kind="loading" title="Loading reports" detail="Reading available work sites…" /> : !sites.length ? (
          <section className="reports-empty panel"><FileCheck2 size={30} /><div><h2>No reportable site yet</h2><p>Create a site and add workers before building operational or historical reports.</p></div><button className="button button--primary" onClick={() => navigate('/')}>Create Site</button></section>
        ) : view === 'history' && selectedSite ? (
          <HistoricalHeatBehaviorPanel site={selectedSite} />
        ) : loading && !data ? <StatePanel kind="loading" title="Building current snapshot" detail="Loading verified conditions and worker exposure context for the selected site…" /> : data ? <>
          <section className="report-hero panel">
            <div><span className="sites-eyebrow">CURRENT SNAPSHOT • NOT HISTORICAL TREND</span><h2>{data.site.name} Operational Report</h2><p>{data.site.address}</p></div>
            <div className="report-hero-meta"><span>Observed</span><strong>{formatTime(data.observedAt)}</strong><small>{sourceLabel(data)} • thermal {data.thermalStatus ?? 'unknown'}</small></div>
            <button className="button button--secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          </section>

          <section className="report-kpi-grid">
            <article className="report-kpi panel"><span><Gauge size={17} /> Overall Risk</span><strong className={`sites-risk-value sites-risk-value--${data.risk?.level ?? 'pending'}`}>{riskLabel(data.risk?.level)}</strong><small>{data.risk?.summary ?? 'Awaiting verified risk calculation'}</small></article>
            <article className="report-kpi panel"><span><UsersRound size={17} /> Active Workers</span><strong>{activeWorkers.length}</strong><small>{data.highExposureCount} high/extreme exposure</small></article>
            <article className="report-kpi panel"><span><CloudSun size={17} /> Temperature</span><strong>{data.conditions ? `${data.conditions.temperatureC.toFixed(1)}°C` : '—'}</strong><small>{data.conditions ? `${data.conditions.heatIndexC.toFixed(1)}°C heat index` : 'No verified conditions'}</small></article>
            <article className="report-kpi panel"><span><Droplets size={17} /> Humidity</span><strong>{data.conditions ? `${data.conditions.humidityPercent.toFixed(0)}%` : '—'}</strong><small>{sourceLabel(data)}</small></article>
          </section>

          <div className="reports-layout">
            <div className="reports-main-column">
              <section className="report-section panel">
                <div className="report-section-heading"><div><span className="sites-eyebrow">EXPOSURE PROFILE</span><h2>Worker Risk Distribution</h2></div><span>{activeWorkers.length} active</span></div>
                <div className="risk-distribution">
                  {(['extreme', 'high', 'medium', 'low'] as RiskLevel[]).map((level) => <div className="risk-distribution-row" key={level}><span>{riskLabel(level)}</span><div className="risk-track"><i className={`risk-fill risk-fill--${level}`} style={{ width: `${percent(riskCounts[level], activeWorkers.length)}%` }} /></div><strong>{riskCounts[level]}</strong><small>{percent(riskCounts[level], activeWorkers.length)}%</small></div>)}
                </div>
                <div className="report-exposure-grid">
                  <article><Sun size={18} /><span>Direct sun</span><strong>{directSun}</strong><small>{percent(directSun, activeWorkers.length)}% of active workers</small></article>
                  <article><BarChart3 size={18} /><span>Heavy workload</span><strong>{heavyWork}</strong><small>{percent(heavyWork, activeWorkers.length)}% of active workers</small></article>
                  <article><ShieldCheck size={18} /><span>Shade gap</span><strong>{shadeGap}</strong><small>Limited or none recorded</small></article>
                  <article><Droplets size={18} /><span>Water gap</span><strong>{waterGap}</strong><small>Water access not confirmed</small></article>
                </div>
              </section>

              <section className="report-section panel">
                <div className="report-section-heading"><div><span className="sites-eyebrow">RISK REGISTER</span><h2>Worker Readiness</h2></div><button className="button button--primary" onClick={() => navigate(`/plan?site=${encodeURIComponent(data.site.id)}`)}><ClipboardList size={16} /> Open Plan</button></div>
                {!workers.length ? <div className="report-no-workers"><UsersRound size={22} /><div><strong>No workers assigned</strong><p>Add worker exposure details to make this report operationally useful.</p></div></div> : <div className="report-worker-table-wrap"><table className="report-worker-table"><thead><tr><th>Worker</th><th>Role / Task</th><th>Exposure</th><th>Controls</th><th>Risk</th></tr></thead><tbody>{workers.map((worker: Worker) => <tr key={worker.id}><td><strong>{worker.name}</strong><small>{worker.team ?? worker.location}</small></td><td><strong>{worker.role}</strong><small>{worker.task ?? 'Task not recorded'}</small></td><td><span>{worker.sunExposure ?? 'unknown'} sun</span><small>{worker.workIntensity ?? 'unknown'} intensity</small></td><td><span>Shade: {worker.shadeAccess ?? 'unknown'}</span><small>Water: {worker.waterAccess == null ? 'unknown' : worker.waterAccess ? 'yes' : 'no'}</small></td><td><span className={`plan-risk-pill plan-risk-pill--${worker.risk}`}>{worker.risk}</span></td></tr>)}</tbody></table></div>}
              </section>
            </div>

            <aside className="reports-side-column">
              <section className="report-section panel">
                <div className="report-section-heading"><div><span className="sites-eyebrow">OPERATIONAL FINDINGS</span><h2>What Needs Attention</h2></div></div>
                <div className="report-findings">{findings.map((item) => <article className={`report-finding report-finding--${item.level}`} key={item.title}><AlertTriangle size={18} /><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>
              </section>

              <section className="report-section panel">
                <div className="report-section-heading"><div><span className="sites-eyebrow">DATA PROVENANCE</span><h2>Source Confidence</h2></div></div>
                <dl className="report-provenance">
                  <div><dt>Atmospheric conditions</dt><dd>{sourceLabel(data)}</dd></div>
                  <div><dt>Observation time</dt><dd>{formatTime(data.observedAt)}</dd></div>
                  <div><dt>FortyGuard thermal</dt><dd>{data.thermalStatus ?? 'unknown'}</dd></div>
                  <div><dt>Fallback active</dt><dd>{data.fallbackActive ? 'Yes' : 'No'}</dd></div>
                  <div><dt>Worker context</dt><dd>{workers.length} saved profile{workers.length === 1 ? '' : 's'}</dd></div>
                </dl>
                {data.conditionSource === 'nws' && <div className="report-source-note"><CloudSun size={18} /><p>NWS is supplying atmospheric conditions. HeatShield is not claiming FortyGuard spatial hotspots while the thermal layer is unavailable.</p></div>}
              </section>
            </aside>
          </div>
        </> : null}
        {error && <div className="form-error">{error}</div>}
      </div>
    </AppShell>
  )
}
