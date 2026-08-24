import {
  AlertTriangle,
  Archive,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Flame,
  History,
  Layers3,
  LoaderCircle,
  MapPinned,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
  TrendingUp,
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
const ARCHIVE_START = '2019-01-01'
type Period = 7 | 14 | 30 | 'custom'
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

function presetRange(days: number) {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(end.getDate() - (days - 1))
  return { startDate: dateOnly(start), endDate: dateOnly(end) }
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysBetween(start: string, end: string) {
  const startMs = new Date(`${start}T00:00:00Z`).getTime()
  const endMs = new Date(`${end}T00:00:00Z`).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.floor((endMs - startMs) / 86_400_000) + 1
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function celsius(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function celsiusToFahrenheit(value: number) {
  return value * 9 / 5 + 32
}

function topZone(zones: HistoricalZoneSample[], key: 'temperatureC' | 'exceedanceHours' | 'persistenceHours') {
  return zones
    .filter((zone) => zone[key] != null)
    .sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity))[0] ?? null
}

function accumulationBand(result: HistoricalHeatBehaviorResponse) {
  if (result.meanExceedanceHours == null || result.dayCount <= 0) return { label: 'Unclassified', tone: 'neutral' }
  const ratio = result.meanExceedanceHours / (result.dayCount * 24)
  if (ratio >= 0.2) return { label: 'Very high', tone: 'critical' }
  if (ratio >= 0.08) return { label: 'High', tone: 'high' }
  if (ratio >= 0.02) return { label: 'Moderate', tone: 'moderate' }
  return { label: 'Low', tone: 'low' }
}

function persistenceBand(value?: number | null) {
  if (value == null) return 'Unclassified'
  if (value >= 12) return 'Prolonged'
  if (value >= 6) return 'Persistent'
  if (value >= 2) return 'Moderate'
  return 'Brief'
}

function archiveWindowLabel(period: Period, start: string, end: string) {
  if (period !== 'custom') return `Latest ${period} completed days`
  if (!start || !end) return 'Choose a historical window'
  return `${formatDate(start)} – ${formatDate(end)}`
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
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [result, setResult] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<MapMetric>('temperature')

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
    setMetric('temperature')
  }, [siteId, setSearchParams])

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const approvedZones = selectedSite?.zones.filter((zone) => zone.operationalApproved) ?? []
  const hottestZone = useMemo(() => result ? topZone(result.zones, 'temperatureC') : null, [result])
  const hottestRepeatedZone = useMemo(() => result ? topZone(result.zones, 'exceedanceHours') : null, [result])
  const mostPersistentZone = useMemo(() => result ? topZone(result.zones, 'persistenceHours') : null, [result])
  const thermalSpread = result?.maxTemperatureC != null && result?.minTemperatureC != null
    ? result.maxTemperatureC - result.minTemperatureC
    : null
  const accumulation = result ? accumulationBand(result) : null
  const persistence = result ? persistenceBand(result.maxPersistenceHours) : null
  const readyResult = Boolean(result && result.dataStatus !== 'configuration_required' && result.dataStatus !== 'unavailable')
  const completedMax = latestCompletedDate()

  const runAnalysis = async () => {
    if (!siteId) return
    if (!Number.isFinite(thresholdC) || thresholdC < -29 || thresholdC > 71) {
      setError('Heat threshold must be between -29°C and 71°C.')
      return
    }

    let range: { startDate: string; endDate: string }
    if (period === 'custom') {
      if (!customStart || !customEnd) {
        setError('Choose both custom start and end dates.')
        return
      }
      if (customStart < ARCHIVE_START) {
        setError('FortyGuard historical archive starts on January 1, 2019.')
        return
      }
      if (customEnd > completedMax) {
        setError('Historical intelligence uses completed days only. Choose yesterday or earlier.')
        return
      }
      if (customStart > customEnd) {
        setError('Custom start date must be on or before the end date.')
        return
      }
      const dayCount = daysBetween(customStart, customEnd)
      if (dayCount > 31) {
        setError('A detailed historical run can cover up to 31 days. Analyze another period separately for comparison.')
        return
      }
      range = { startDate: customStart, endDate: customEnd }
    } else {
      range = presetRange(period)
    }

    setLoading(true)
    setError(null)
    setMetric('temperature')
    try {
      const response = await api.generateHistoricalHeatBehavior(siteId, {
        ...range,
        thresholdF: celsiusToFahrenheit(thresholdC),
        granularityMeters: granularity,
      })
      setResult(response)
      if (response.dataStatus === 'unavailable' || response.dataStatus === 'configuration_required') {
        setError(response.message ?? 'FortyGuard historical evidence is unavailable for this request.')
      }
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'Could not generate historical heat intelligence.')
    } finally {
      setLoading(false)
    }
  }

  const useArchiveYear = (year: number) => {
    const current = presetRange(30)
    const startParts = current.startDate.split('-')
    const endParts = current.endDate.split('-')
    const start = `${year}-${startParts[1]}-${startParts[2]}`
    const end = `${year}-${endParts[1]}-${endParts[2]}`
    setPeriod('custom')
    setCustomStart(start < ARCHIVE_START ? ARCHIVE_START : start)
    setCustomEnd(end > completedMax ? completedMax : end)
    setResult(null)
    setError(null)
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId}
        onSiteChange={setSiteId}
        pageTitle="Historical Heat Intelligence"
        pageSubtitle="Discover how a site behaves under heat using verified FortyGuard historical spatial evidence from 2019 onward."
        showAddSite={false}
        showObservation={false}
      />

      <div className="history-page history-page--intelligence">
        {loadingSites ? <StatePanel kind="loading" title="Loading historical intelligence" detail="Reading available work sites…" /> : !sites.length ? (
          <section className="history-empty panel"><History size={30} /><div><h2>Create a site first</h2><p>Historical analysis needs a saved site polygon before FortyGuard can evaluate spatial heat behavior.</p></div><button className="button button--primary" onClick={() => navigate('/')}>Create Site</button></section>
        ) : selectedSite ? <>
          <section className="history-hero panel">
            <div className="history-hero__copy">
              <span className="history-eyebrow">FORTYGUARD HISTORICAL INTELLIGENCE</span>
              <h2>How does {selectedSite.name} behave under heat over time?</h2>
              <p>Interrogate a completed historical window to understand temperature distribution, repeated threshold exposure, heat retention, peak timing and persistent spatial hotspots. HeatShield derives patterns only from returned provider evidence.</p>
              <div className="history-hero__badges">
                <span><Archive size={15} /> Archive: Jan 2019 → present</span>
                <span><Database size={15} /> 4 FortyGuard evidence layers</span>
                <span><MapPinned size={15} /> {approvedZones.length} approved work zone{approvedZones.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="history-hero__mission">
              <span>THIS SCREEN ANSWERS</span>
              <strong>When does heat peak, where does it persist, and what does that mean operationally?</strong>
              <small>Historical evidence is separated from HeatShield-derived interpretation.</small>
            </div>
          </section>

          <section className="history-archive panel">
            <div className="history-archive__head">
              <div><span className="history-eyebrow">ARCHIVE EXPLORER</span><h2>Choose a historical window</h2><p>Detailed range analysis uses completed days and up to 31 days per run. Re-run another year or season to compare behavior without fabricating a long-range aggregate.</p></div>
              <div className="history-archive__window"><CalendarDays size={16} /><div><span>Selected window</span><strong>{archiveWindowLabel(period, customStart, customEnd)}</strong></div></div>
            </div>

            <div className="history-year-jump" aria-label="Historical archive year shortcuts">
              <span>Jump to same 30-day season:</span>
              {Array.from({ length: new Date().getFullYear() - 2018 }, (_, index) => 2019 + index).map((year) => (
                <button type="button" key={year} onClick={() => useArchiveYear(year)}>{year}</button>
              ))}
            </div>

            <div className="history-controls history-controls--intelligence">
              <div className="history-control-group history-control-group--period">
                <label>Analysis period</label>
                <div className="history-period-switch">
                  {[7, 14, 30].map((days) => <button key={days} type="button" className={period === days ? 'active' : ''} onClick={() => { setPeriod(days as 7 | 14 | 30); setResult(null); setError(null) }}>Last {days} days</button>)}
                  <button type="button" className={period === 'custom' ? 'active' : ''} onClick={() => { setPeriod('custom'); setResult(null); setError(null) }}>Custom</button>
                </div>
              </div>

              {period === 'custom' && <div className="history-custom-dates">
                <label><span>Start date</span><input type="date" value={customStart} min={ARCHIVE_START} max={completedMax} onChange={(event) => { setCustomStart(event.target.value); setResult(null) }} /></label>
                <label><span>End date</span><input type="date" value={customEnd} min={ARCHIVE_START} max={completedMax} onChange={(event) => { setCustomEnd(event.target.value); setResult(null) }} /></label>
              </div>}

              <label className="history-field"><span>Heat threshold</span><div className="history-threshold"><input type="number" min={-29} max={71} step={0.5} value={thresholdC} onChange={(event) => { setThresholdC(Number(event.target.value)); setResult(null) }} /><strong>°C</strong></div><small>Used for exceedance and persistence</small></label>
              <label className="history-field"><span>Spatial resolution</span><select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value) as 60 | 80 | 100); setResult(null) }}><option value={60}>60 m · detailed</option><option value={80}>80 m · balanced</option><option value={100}>100 m · credit-aware</option></select><small>Applied to all historical layers</small></label>

              <button type="button" className="button button--primary history-run" onClick={() => void runAnalysis()} disabled={loading}>
                {loading ? <LoaderCircle className="history-spin" size={18} /> : <Sparkles size={18} />}
                {loading ? 'Analyzing FortyGuard history…' : 'Analyze Historical Patterns'}
              </button>
            </div>
          </section>

          {!result && !loading && <section className="history-ready history-ready--intelligence panel">
            <div className="history-ready__icon"><History size={25} /></div>
            <div><strong>Ready to build a Site Heat Signature</strong><p>HeatShield will request temperature, exceedance, persistence and peak-time layers, then spatially join those cells to your saved work zones.</p></div>
            <div className="history-ready__steps"><span><b>1</b> Provider evidence</span><span><b>2</b> Pattern detection</span><span><b>3</b> Operational meaning</span></div>
          </section>}

          {loading && <section className="history-ready history-ready--intelligence panel"><div className="history-ready__icon"><LoaderCircle className="history-spin" size={25} /></div><div><strong>Building historical intelligence</strong><p>Requesting four FortyGuard spatial layers and combining only verified cells. This can take longer than a single heatmap.</p></div></section>}

          {readyResult && result && <>
            <section className="history-result-head panel">
              <div><span className="history-eyebrow">ANALYSIS WINDOW</span><h2>{formatDate(result.startDate)} – {formatDate(result.endDate)}</h2><p>{result.dayCount} completed days · threshold {result.thresholdC.toFixed(1)}°C · {result.granularityMeters} m cells · {result.timezoneName}</p></div>
              <div className={`history-status history-status--${result.dataStatus}`}><CheckCircle2 size={17} /><strong>{result.dataStatus === 'verified' ? 'Verified FortyGuard evidence' : 'Partial provider evidence'}</strong><span>{result.providerRequestCount} provider request{result.providerRequestCount === 1 ? '' : 's'} · {result.cached ? 'cached result' : 'fresh result'}</span></div>
            </section>

            <section className="history-signature panel">
              <div className="history-signature__intro">
                <span className="history-eyebrow">HEATSHIELD-DERIVED INTERPRETATION</span>
                <h2>Site Heat Signature</h2>
                <p>For this selected historical window, HeatShield summarizes the site&apos;s repeatable thermal behavior without changing the underlying provider measurements.</p>
              </div>
              <div className="history-signature__grid">
                <article><span>Threshold burden</span><strong className={`history-tone history-tone--${accumulation?.tone ?? 'neutral'}`}>{accumulation?.label ?? '—'}</strong><small>Derived from mean hours above {result.thresholdC.toFixed(1)}°C across matched cells</small></article>
                <article><span>Heat retention</span><strong>{persistence}</strong><small>{result.maxPersistenceHours != null ? `Longest verified continuous run: ${hours(result.maxPersistenceHours)}` : 'Persistence layer unavailable'}</small></article>
                <article><span>Typical peak</span><strong>{result.commonPeakPeriodLocal ?? '—'}</strong><small>Most common local peak period across matched spatial cells</small></article>
                <article><span>Recurring hotspot</span><strong>{hottestRepeatedZone?.zoneName ?? hottestZone?.zoneName ?? 'Spatial cell'}</strong><small>{hottestRepeatedZone ? `${hours(hottestRepeatedZone.exceedanceHours)} above threshold` : hottestZone?.temperatureC != null ? `${celsius(hottestZone.temperatureC)} provider value` : 'Use the map to inspect the hottest cells'}</small></article>
                <article><span>Spatial contrast</span><strong>{thermalSpread == null ? '—' : `${thermalSpread.toFixed(1)}°C`}</strong><small>Difference between lowest and highest matched temperature cells</small></article>
              </div>
            </section>

            <section className="history-kpis history-kpis--six">
              <article className="history-kpi panel"><span><ThermometerSun size={17} /> Mean Temperature</span><strong>{celsius(result.meanTemperatureC)}</strong><small>Mean of matched FortyGuard temperature cells for this historical layer</small></article>
              <article className="history-kpi panel"><span><TrendingUp size={17} /> Hottest Cell</span><strong>{celsius(result.maxTemperatureC)}</strong><small>Highest returned temperature value in the selected spatial layer</small></article>
              <article className="history-kpi panel"><span><Flame size={17} /> Max Exceedance</span><strong>{hours(result.maxExceedanceHours)}</strong><small>Accumulated time above {result.thresholdC.toFixed(1)}°C in the strongest matched cell</small></article>
              <article className="history-kpi panel"><span><Flame size={17} /> Max Persistence</span><strong>{hours(result.maxPersistenceHours)}</strong><small>Longest continuous high-heat run returned by FortyGuard</small></article>
              <article className="history-kpi panel"><span><Clock3 size={17} /> Typical Peak</span><strong>{result.commonPeakPeriodLocal ?? '—'}</strong><small>Most common local peak interval across matched cells</small></article>
              <article className="history-kpi panel"><span><Layers3 size={17} /> Historical Cells</span><strong>{result.cellCount}</strong><small>Spatial cells combined into this evidence view</small></article>
            </section>

            <section className="history-patterns panel">
              <div className="history-section-head"><div><span className="history-eyebrow">PATTERN DETECTION</span><h2>What repeats in this historical window?</h2><p>These findings are deterministic interpretations of the returned layers, not synthetic provider observations.</p></div></div>
              <div className="history-pattern-grid">
                <article><div className="history-pattern-icon"><Flame size={18} /></div><div><span>EXPOSURE PATTERN</span><strong>{accumulation?.label ?? 'Unclassified'} threshold burden</strong><p>{result.meanExceedanceHours != null ? `A matched cell averaged ${hours(result.meanExceedanceHours)} above ${result.thresholdC.toFixed(1)}°C across this ${result.dayCount}-day window.` : 'Exceedance evidence was not available for enough cells.'}</p></div></article>
                <article><div className="history-pattern-icon"><BarChart3 size={18} /></div><div><span>RETENTION PATTERN</span><strong>{persistence} heat persistence</strong><p>{mostPersistentZone ? `${mostPersistentZone.zoneName} carries the strongest named-zone persistence at ${hours(mostPersistentZone.persistenceHours)}.` : `The longest continuous matched run was ${hours(result.maxPersistenceHours)}.`}</p></div></article>
                <article><div className="history-pattern-icon"><Clock3 size={18} /></div><div><span>TIME PATTERN</span><strong>{result.commonPeakPeriodLocal ? `Heat most often peaks ${result.commonPeakPeriodLocal}` : 'Peak window unavailable'}</strong><p>{result.commonPeakPeriodLocal ? 'This is the dominant local peak period across returned cells for the selected historical window.' : 'FortyGuard did not return enough peak-time evidence for a dominant period.'}</p></div></article>
                <article><div className="history-pattern-icon"><MapPinned size={18} /></div><div><span>SPATIAL PATTERN</span><strong>{hottestRepeatedZone?.zoneName ?? hottestZone?.zoneName ?? 'Inspect spatial cells'}</strong><p>{hottestRepeatedZone ? 'This saved zone has the strongest matched accumulated exceedance and should be treated as a recurring hotspot candidate.' : thermalSpread != null ? `Returned temperature cells span ${thermalSpread.toFixed(1)}°C across the site.` : 'No saved zone had enough matched evidence for a named hotspot.'}</p></div></article>
              </div>
            </section>

            <HistoricalHeatMap site={selectedSite} result={result} metric={metric} onMetricChange={setMetric} />

            <div className="history-detail-grid">
              <section className="history-zones panel">
                <div className="history-section-head"><div><span className="history-eyebrow">WORK-ZONE EVIDENCE</span><h2>Where does heat affect operations?</h2><p>Saved site zones are joined locally to the shared FortyGuard grids; no extra provider request is spent per zone.</p></div><span>{result.zones.length} sampled zone{result.zones.length === 1 ? '' : 's'}</span></div>
                {!result.zones.length ? <div className="history-inline-empty"><MapPinned size={20} /><div><strong>No saved zones to rank</strong><p>Add operational zones on the Sites screen to connect historical cells to named work areas.</p></div></div> : <div className="history-zone-list">
                  {result.zones.map((zone, index) => <article key={zone.zoneId} className="history-zone-row history-zone-row--temperature">
                    <span className="history-zone-rank">{index + 1}</span>
                    <div className="history-zone-name"><strong>{zone.zoneName}</strong><small>{zone.zoneType.replace('-', ' ')} · {zone.evidenceStatus}</small></div>
                    <div><span>Temperature</span><strong>{celsius(zone.temperatureC)}</strong></div>
                    <div><span>Above threshold</span><strong>{hours(zone.exceedanceHours)}</strong></div>
                    <div><span>Longest run</span><strong>{hours(zone.persistenceHours)}</strong></div>
                    <div><span>Peak</span><strong>{zone.peakHourLocal ?? '—'}</strong></div>
                  </article>)}
                </div>}
              </section>

              <aside className="history-insights panel">
                <div className="history-section-head"><div><span className="history-eyebrow">OPERATIONAL MEANING</span><h2>How should this history be used?</h2></div></div>
                <div className="history-insight-list">
                  <article><ThermometerSun size={18} /><div><strong>Temperature context</strong><p>{result.meanTemperatureC != null ? `The selected historical layer has a mean matched temperature of ${celsius(result.meanTemperatureC)} and a hottest matched value of ${celsius(result.maxTemperatureC)}.` : 'The temperature layer is unavailable; HeatShield will not infer a historical temperature.'}</p></div></article>
                  <article><Flame size={18} /><div><strong>Recurring exposure</strong><p>{hottestRepeatedZone ? `${hottestRepeatedZone.zoneName} has the strongest named-zone exceedance at ${hours(hottestRepeatedZone.exceedanceHours)} above ${result.thresholdC.toFixed(1)}°C.` : `The strongest matched cell accumulated ${hours(result.maxExceedanceHours)} above the selected threshold.`}</p></div></article>
                  <article><AlertTriangle size={18} /><div><strong>Heat retention</strong><p>{mostPersistentZone ? `${mostPersistentZone.zoneName} shows the longest named-zone continuous run at ${hours(mostPersistentZone.persistenceHours)}.` : `The longest matched continuous high-heat run was ${hours(result.maxPersistenceHours)}.`}</p></div></article>
                  <article><Clock3 size={18} /><div><strong>Planning window</strong><p>{result.commonPeakPeriodLocal ? `${result.commonPeakPeriodLocal} is the dominant peak period in this window. Use it as historical context, not as a guarantee for today.` : 'Peak-time evidence was not available across enough cells.'}</p></div></article>
                </div>
                <button className="button button--primary history-plan-link" type="button" onClick={() => navigate(`/plan?site=${encodeURIComponent(selectedSite.id)}`)}>Use Site Context in Operational Planner</button>
              </aside>
            </div>

            <section className="history-provenance panel">
              <div><span className="history-eyebrow">EVIDENCE &amp; PROVENANCE</span><h2>What came from FortyGuard?</h2><p>Provider-returned values stay separate from HeatShield&apos;s interpretation layer.</p></div>
              <div className="history-layer-statuses history-layer-statuses--four">{result.layers.map((layer) => <article key={layer.analyticType}><span className={`history-layer-dot history-layer-dot--${layer.status}`} /><div><strong>{layer.analyticType === 'tcm' ? 'Temperature' : layer.analyticType === 'time_of_measure' ? 'Peak time' : layer.analyticType}</strong><small>{layer.status === 'verified' ? `${layer.cellCount} verified cells · ${layer.units ?? 'provider units'}` : layer.message ?? 'Layer unavailable'}</small></div></article>)}</div>
              <p><ShieldCheck size={15} /> Temperature cells, exceedance hours, persistence hours and peak-time values are FortyGuard evidence. Site Heat Signature, pattern labels and operational meaning are HeatShield-derived interpretations of those returned values. Missing provider layers are never replaced with synthetic cells.</p>
            </section>
          </>}

          {result && (result.dataStatus === 'configuration_required' || result.dataStatus === 'unavailable') && !loading && <section className="history-ready panel"><AlertTriangle size={25} /><div><strong>Historical evidence unavailable</strong><p>{result.message ?? 'FortyGuard did not return usable historical cells for this request.'}</p></div></section>}
        </> : null}

        {error && <div className="form-error history-error">{error}</div>}
      </div>
    </AppShell>
  )
}
