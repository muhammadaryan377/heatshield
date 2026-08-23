import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  History,
  LoaderCircle,
  MapPinned,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HistoricalHeatMap } from '../components/history/HistoricalHeatMap'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { HistoricalHeatBehaviorResponse, HistoricalZoneSample } from '../types/history'
import type { Site } from '../types/site'

const STORAGE_KEY = 'heatshield:selected-site'
type Period = 7 | 30 | 'custom'
type MapMetric = 'exceedance' | 'persistence' | 'peak'

function dateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function lastCompleteDay() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return dateOnly(date)
}

function presetRange(days: number) {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  return { startDate: dateOnly(start), endDate: dateOnly(end) }
}

function inclusiveDayCount(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.floor((endMs - startMs) / 86_400_000) + 1
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function fahrenheitToC(value: number) {
  return (value - 32) * 5 / 9
}

function topZone(zones: HistoricalZoneSample[], key: 'exceedanceHours' | 'persistenceHours') {
  return zones
    .filter((zone) => zone[key] != null)
    .sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1))[0] ?? null
}

export function HeatHistoryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [period, setPeriod] = useState<Period>(30)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [thresholdF, setThresholdF] = useState(95)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [result, setResult] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<MapMetric>('exceedance')

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
    if (!siteId) return
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    setResult(null)
    setError(null)
  }, [siteId, setSearchParams])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const selectedSitePolygonReady = Boolean(selectedSite && selectedSite.polygon.length >= 3)
  const approvedZoneCount = selectedSite?.zones.filter((zone) => zone.operationalApproved).length ?? 0
  const hottestRepeatedZone = useMemo(() => result ? topZone(result.zones, 'exceedanceHours') : null, [result])
  const mostPersistentZone = useMemo(() => result ? topZone(result.zones, 'persistenceHours') : null, [result])

  const runAnalysis = async () => {
    if (!siteId || !selectedSite) {
      setError('Select a saved site before running historical analysis.')
      return
    }
    if (!selectedSitePolygonReady) {
      setError('This site does not have a complete boundary yet. Open Sites and draw at least three boundary points first.')
      return
    }
    if (!Number.isFinite(thresholdF) || thresholdF < -20 || thresholdF > 160) {
      setError('Threshold must be between -20°F and 160°F.')
      return
    }
    let range: { startDate: string; endDate: string }
    if (period === 'custom') {
      if (!customStart || !customEnd) {
        setError('Choose both custom start and end dates.')
        return
      }
      if (customStart > customEnd) {
        setError('Custom start date must be on or before the end date.')
        return
      }
      if (customEnd > lastCompleteDay()) {
        setError('FortyGuard range history must end on yesterday or an earlier completed day.')
        return
      }
      if (inclusiveDayCount(customStart, customEnd) > 31) {
        setError('FortyGuard range-of-days analysis supports up to 31 days per request.')
        return
      }
      range = { startDate: customStart, endDate: customEnd }
    } else {
      range = presetRange(period)
    }

    setLoading(true)
    setError(null)
    try {
      const response = await api.generateHistoricalHeatBehavior(siteId, {
        ...range,
        thresholdF,
        granularityMeters: granularity,
      })
      setResult(response)
      if (response.dataStatus === 'unavailable' || response.dataStatus === 'configuration_required') {
        setError(response.message ?? 'FortyGuard historical evidence is unavailable for this request.')
      }
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Could not generate historical heat behavior.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId}
        onSiteChange={setSiteId}
        pageTitle="Site Heat History"
        pageSubtitle="Understand where heat repeatedly accumulates, how long it persists, and when this site typically peaks."
        showAddSite={false}
        showSiteSelector={false}
        showObservation={false}
      />

      <div className="history-page">
        {loadingSites ? <StatePanel kind="loading" title="Loading heat history" detail="Reading available work sites…" /> : !sites.length ? (
          <section className="history-empty panel"><History size={30} /><div><h2>Create a site first</h2><p>Historical analysis needs a real site polygon before FortyGuard can evaluate spatial heat behavior.</p></div><button className="button button--primary" onClick={() => navigate('/sites')}>Create Site</button></section>
        ) : selectedSite ? <>
          <section className="history-site-selector panel">
            <div className="history-site-selector__main">
              <span className="history-eyebrow">SITE TO ANALYZE</span>
              <label className="history-site-select-control">
                <MapPinned size={18} />
                <select value={siteId ?? ''} onChange={(event) => setSiteId(event.target.value || null)} aria-label="Select site for heat history">
                  {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </label>
              <p>{selectedSite.address || `${selectedSite.center.lat.toFixed(5)}, ${selectedSite.center.lng.toFixed(5)}`}</p>
              <small>{approvedZoneCount === 0 ? 'No approved zones yet. Whole-site historical analysis still uses the complete saved site polygon.' : 'Approved zones are optional sub-areas; the full saved site polygon remains the analysis boundary.'}</small>
            </div>
            <div className="history-site-selector__meta">
              <span><strong>{selectedSite.polygon.length}</strong> boundary points</span>
              <span><strong>{approvedZoneCount}</strong> approved zone{approvedZoneCount === 1 ? '' : 's'}</span>
              <span className={selectedSitePolygonReady ? 'history-site-ready' : 'history-site-blocked'}>
                {selectedSitePolygonReady ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                {selectedSitePolygonReady ? 'Whole-site polygon ready' : 'Site boundary required'}
              </span>
              <button type="button" className="button button--quiet" onClick={() => navigate('/sites')}>Review site boundary</button>
            </div>
          </section>

          <section className="history-intro panel">
            <div className="history-intro__copy">
              <span className="history-eyebrow">FORTYGUARD HISTORICAL INTELLIGENCE</span>
              <h2>How does {selectedSite.name} normally behave under heat?</h2>
              <p>Three shared site-wide FortyGuard range analyses compare repeated threshold exceedance, continuous heat persistence and the time each thermal cell usually peaks. HeatShield uses completed days so the provider is not asked to summarize a partial current day.</p>
            </div>
            <div className="history-intro__facts">
              <span><MapPinned size={16} /> {approvedZoneCount} approved zone{approvedZoneCount === 1 ? '' : 's'}</span>
              <span><ShieldCheck size={16} /> FortyGuard coverage from 2019</span>
              <span><Sparkles size={16} /> 3 provider analyses per run</span>
            </div>
          </section>

          <section className="history-controls panel">
            <div className="history-control-group history-control-group--period">
              <label>Analysis period</label>
              <div className="history-period-switch">
                {[7, 30].map((days) => <button key={days} type="button" className={period === days ? 'active' : ''} onClick={() => { setPeriod(days as 7 | 30); setResult(null) }}>Last {days} complete days</button>)}
                <button type="button" className={period === 'custom' ? 'active' : ''} onClick={() => { setPeriod('custom'); setResult(null) }}>Custom ≤31d</button>
              </div>
            </div>

            {period === 'custom' && <div className="history-custom-dates">
              <label><span>Start date</span><input type="date" value={customStart} min="2019-01-01" max={lastCompleteDay()} onChange={(event) => { setCustomStart(event.target.value); setResult(null) }} /></label>
              <label><span>End date</span><input type="date" value={customEnd} min="2019-01-01" max={lastCompleteDay()} onChange={(event) => { setCustomEnd(event.target.value); setResult(null) }} /></label>
            </div>}

            <label className="history-field"><span>Heat threshold</span><div className="history-threshold"><input type="number" min={-20} max={160} step={1} value={thresholdF} onChange={(event) => { setThresholdF(Number(event.target.value)); setResult(null) }} /><strong>°F</strong></div><small>{fahrenheitToC(thresholdF).toFixed(1)}°C sent to FortyGuard</small></label>
            <label className="history-field"><span>Spatial resolution</span><select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value) as 60 | 80 | 100); setResult(null) }}><option value={60}>60 m · detailed</option><option value={80}>80 m · balanced</option><option value={100}>100 m · credit-aware</option></select><small>Same resolution for all 3 layers</small></label>

            <button type="button" className="button button--primary history-run" onClick={() => void runAnalysis()} disabled={loading || !selectedSitePolygonReady}>
              {loading ? <LoaderCircle className="history-spin" size={18} /> : selectedSitePolygonReady ? <ThermometerSun size={18} /> : <AlertTriangle size={18} />}
              {loading ? 'Analyzing FortyGuard history…' : selectedSitePolygonReady ? `Analyze ${selectedSite.name}` : 'Draw site boundary first'}
            </button>
          </section>

          {!result && !loading && selectedSitePolygonReady && <section className="history-ready panel"><History size={28} /><div><strong>Ready for FortyGuard historical analysis</strong><p>{selectedSite.name} is selected. Choose 7 or 30 completed days, or a custom range up to 31 days. HeatShield will not fabricate historical cells when provider evidence is unavailable.</p></div></section>}
          {!selectedSitePolygonReady && <section className="history-ready history-ready--blocked panel"><AlertTriangle size={28} /><div><strong>Site boundary required</strong><p>Historical analysis is site-specific. Open Sites, draw the complete work-area polygon, save it, then return here.</p></div><button className="button button--quiet" type="button" onClick={() => navigate('/sites')}>Open Sites</button></section>}
          {loading && <section className="history-ready panel"><LoaderCircle className="history-spin" size={28} /><div><strong>Building site heat history</strong><p>Requesting exceedance, persistence and time-of-measure layers for the full saved site polygon, then joining them to approved operational zones when available.</p></div></section>}

          {result && result.dataStatus !== 'configuration_required' && result.dataStatus !== 'unavailable' && <>
            <section className="history-result-head panel">
              <div><span className="history-eyebrow">ANALYSIS WINDOW</span><h2>{formatDate(result.startDate)} – {formatDate(result.endDate)}</h2><p>{result.dayCount} days · threshold {result.thresholdF.toFixed(0)}°F ({result.thresholdC.toFixed(1)}°C) · {result.granularityMeters} m cells</p></div>
              <div className={`history-status history-status--${result.dataStatus}`}><CheckCircle2 size={17} /><strong>{result.dataStatus === 'verified' ? 'Verified FortyGuard history' : 'Partial provider evidence'}</strong><span>{result.providerRequestCount} provider request{result.providerRequestCount === 1 ? '' : 's'} · {result.cached ? 'cached' : 'fresh'}</span></div>
            </section>

            <section className="history-kpis">
              <article className="history-kpi panel"><span><Flame size={17} /> Max Exceedance</span><strong>{hours(result.maxExceedanceHours)}</strong><small>Longest accumulated time above {result.thresholdF.toFixed(0)}°F in any matched cell</small></article>
              <article className="history-kpi panel"><span><Flame size={17} /> Max Persistence</span><strong>{hours(result.maxPersistenceHours)}</strong><small>Longest continuous high-heat run in any matched cell</small></article>
              <article className="history-kpi panel"><span><Clock3 size={17} /> Typical Peak</span><strong>{result.commonPeakPeriodLocal ?? '—'}</strong><small>Most common local peak period across matched cells</small></article>
              <article className="history-kpi panel"><span><MapPinned size={17} /> Historical Cells</span><strong>{result.cellCount}</strong><small>Spatial cells included in this combined historical view</small></article>
            </section>

            <HistoricalHeatMap site={selectedSite} result={result} metric={metric} onMetricChange={setMetric} />

            <div className="history-detail-grid">
              <section className="history-zones panel">
                <div className="history-section-head"><div><span className="history-eyebrow">APPROVED ZONE RANKING</span><h2>Where heat accumulates</h2></div><span>{result.zones.length} sampled zone{result.zones.length === 1 ? '' : 's'}</span></div>
                {!result.zones.length ? <div className="history-inline-empty"><MapPinned size={20} /><div><strong>No approved zones to rank</strong><p>The whole-site result above is still valid. Add operational zones on the Sites screen only if you want named sub-area comparisons.</p></div></div> : <div className="history-zone-list">
                  {result.zones.map((zone, index) => <article key={zone.zoneId} className="history-zone-row">
                    <span className="history-zone-rank">{index + 1}</span>
                    <div className="history-zone-name"><strong>{zone.zoneName}</strong><small>{zone.zoneType.replace('-', ' ')} · {zone.evidenceStatus}</small></div>
                    <div><span>Above threshold</span><strong>{hours(zone.exceedanceHours)}</strong></div>
                    <div><span>Longest run</span><strong>{hours(zone.persistenceHours)}</strong></div>
                    <div><span>Peak</span><strong>{zone.peakHourLocal ?? '—'}</strong></div>
                  </article>)}
                </div>}
              </section>

              <aside className="history-insights panel">
                <div className="history-section-head"><div><span className="history-eyebrow">PLANNING IMPLICATIONS</span><h2>What this history means</h2></div></div>
                <div className="history-insight-list">
                  <article><Flame size={18} /><div><strong>Repeated heat accumulation</strong><p>{hottestRepeatedZone ? `${hottestRepeatedZone.zoneName} has the highest matched zone exceedance at ${hours(hottestRepeatedZone.exceedanceHours)} above ${result.thresholdF.toFixed(0)}°F.` : `The hottest matched cell accumulated up to ${hours(result.maxExceedanceHours)} above the selected threshold.`}</p></div></article>
                  <article><AlertTriangle size={18} /><div><strong>Heat retention</strong><p>{mostPersistentZone ? `${mostPersistentZone.zoneName} shows the longest approved-zone continuous run at ${hours(mostPersistentZone.persistenceHours)}.` : `The longest matched continuous high-heat run was ${hours(result.maxPersistenceHours)}.`}</p></div></article>
                  <article><Clock3 size={18} /><div><strong>Typical peak window</strong><p>{result.commonPeakPeriodLocal ? `Across matched cells, ${result.commonPeakPeriodLocal} is the most common peak period. Treat this as site-history evidence, not a guarantee for today's weather.` : 'Peak-time evidence was not available across enough cells for this run.'}</p></div></article>
                </div>
                <button className="button button--primary history-plan-link" type="button" onClick={() => navigate(`/plan?site=${encodeURIComponent(selectedSite.id)}`)}>Use in Today&apos;s Planner</button>
              </aside>
            </div>

            <section className="history-provenance panel">
              <div><span className="history-eyebrow">DATA PROVENANCE</span><h2>FortyGuard analysis layers</h2></div>
              <div className="history-layer-statuses">{result.layers.map((layer) => <article key={layer.analyticType}><span className={`history-layer-dot history-layer-dot--${layer.status}`} /><div><strong>{layer.analyticType.replaceAll('_', ' ')}</strong><small>{layer.status === 'verified' ? `${layer.cellCount} verified cells${layer.activityId ? ` · ${layer.activityId.slice(0, 8)}…` : ''}` : layer.message ?? 'Unavailable'}</small></div></article>)}</div>
              <p>{result.message}</p>
            </section>
          </>}

          {error && <div className="form-error history-error">{error}</div>}
        </> : null}
      </div>
    </AppShell>
  )
}
