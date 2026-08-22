import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  Layers3,
  LoaderCircle,
  MapPinned,
  RotateCcw,
  TimerReset,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../../types/history'
import type { Site } from '../../types/site'

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
type Metric = 'exceedance' | 'persistence' | 'peak'
type Period = 7 | 30 | 90 | 'custom'

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function rangeForDays(days: number) {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  return { start: isoDate(start), end: isoDate(end) }
}

function metricValue(cell: HistoricalHeatCell, metric: Metric) {
  if (metric === 'exceedance') return cell.exceedanceHours ?? null
  if (metric === 'persistence') return cell.persistenceHours ?? null
  return cell.peakHourUtc ?? null
}

function metricTitle(metric: Metric) {
  if (metric === 'exceedance') return 'Heat Exceedance'
  if (metric === 'persistence') return 'Heat Persistence'
  return 'Peak Time'
}

function metricUnit(metric: Metric) {
  return metric === 'peak' ? 'hour' : 'h'
}

function colorFor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.001)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.2) return '#198f8a'
  if (ratio < 0.4) return '#6ab769'
  if (ratio < 0.6) return '#e2bd43'
  if (ratio < 0.8) return '#ed882e'
  return '#df4b42'
}

function formatNumber(value?: number | null, suffix = '') {
  return value == null ? '—' : `${value.toFixed(1)}${suffix}`
}

function HistoricalMap({ site, result, metric }: { site: Site; result: HistoricalHeatBehaviorResponse; metric: Metric }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!apiKey || !ref.current || !result.cells.length) return
    let cancelled = false
    const overlays: google.maps.Polygon[] = []
    const markers: google.maps.Marker[] = []
    const infos: google.maps.InfoWindow[] = []

    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !ref.current) return
      const map = new googleInstance.maps.Map(ref.current, {
        center: site.center,
        zoom: 16,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      })
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 42)

      const values = result.cells.map((cell) => metricValue(cell, metric)).filter((value): value is number => value != null)
      const min = values.length ? Math.min(...values) : 0
      const max = values.length ? Math.max(...values) : 1

      result.cells.forEach((cell) => {
        const value = metricValue(cell, metric)
        if (value == null || cell.polygon.length < 3) return
        const color = colorFor(value, min, max)
        const polygon = new googleInstance.maps.Polygon({
          map,
          paths: cell.polygon,
          strokeColor: color,
          strokeOpacity: 0.8,
          strokeWeight: 1,
          fillColor: color,
          fillOpacity: 0.58,
          clickable: true,
          zIndex: 10,
        })
        const display = metric === 'peak' ? (cell.peakHourLocal ?? `${value}:00 UTC`) : `${value.toFixed(1)} hours`
        const info = new googleInstance.maps.InfoWindow({
          content: `<div style="min-width:150px"><strong>${metricTitle(metric)}</strong><br/><span>${display}</span><br/><small>FortyGuard historical cell</small></div>`,
        })
        polygon.addListener('click', (event: google.maps.PolyMouseEvent) => {
          infos.forEach((item) => item.close())
          if (event.latLng) info.setPosition(event.latLng)
          info.open({ map })
        })
        overlays.push(polygon)
        infos.push(info)
      })

      new googleInstance.maps.Polygon({
        map,
        paths: site.polygon,
        strokeColor: '#48d4c7',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillOpacity: 0,
        clickable: false,
        zIndex: 20,
      })

      site.zones.forEach((zone) => {
        const marker = new googleInstance.maps.Marker({
          map,
          position: zone.center,
          title: zone.name,
          zIndex: 30,
          icon: {
            path: googleInstance.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#ffffff',
            fillOpacity: 1,
            strokeColor: '#0b8b87',
            strokeWeight: 3,
          },
        })
        markers.push(marker)
      })
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message) })

    return () => {
      cancelled = true
      overlays.forEach((polygon) => polygon.setMap(null))
      markers.forEach((marker) => marker.setMap(null))
      infos.forEach((info) => info.close())
    }
  }, [metric, result, site])

  if (!apiKey) return <div className="history-map-fallback"><MapPinned size={24} /><strong>Google Maps key required</strong><span>Historical metrics are still available in the tables below.</span></div>
  if (error) return <div className="history-map-fallback"><AlertTriangle size={24} /><strong>Map unavailable</strong><span>{error}</span></div>
  return <div ref={ref} className="history-map-canvas" aria-label={`${metricTitle(metric)} map`} />
}

export function HistoricalHeatBehaviorPanel({ site }: { site: Site }) {
  const initial = useMemo(() => rangeForDays(30), [site.id])
  const [period, setPeriod] = useState<Period>(30)
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [thresholdF, setThresholdF] = useState(95)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [metric, setMetric] = useState<Metric>('exceedance')
  const [result, setResult] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = rangeForDays(30)
    setPeriod(30)
    setStartDate(next.start)
    setEndDate(next.end)
    setResult(null)
    setError(null)
  }, [site.id])

  const choosePeriod = (value: Period) => {
    setPeriod(value)
    setResult(null)
    if (value !== 'custom') {
      const next = rangeForDays(value)
      setStartDate(next.start)
      setEndDate(next.end)
    }
  }

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.generateHistoricalHeatBehavior(site.id, {
        startDate,
        endDate,
        thresholdF,
        granularityMeters: granularity,
      })
      setResult(response)
      if (response.dataStatus === 'unavailable' || response.dataStatus === 'configuration_required') {
        setError(response.message ?? 'FortyGuard historical data is unavailable for this request.')
      }
    } catch (reason) {
      setResult(null)
      setError(reason instanceof Error ? reason.message : 'Could not run historical analysis.')
    } finally {
      setLoading(false)
    }
  }

  const layer = (name: HistoricalHeatBehaviorResponse['layers'][number]['analyticType']) => result?.layers.find((item) => item.analyticType === name)
  const topZone = result?.zones.find((zone) => zone.exceedanceHours != null) ?? null

  return (
    <div className="history-report">
      <section className="history-controls panel">
        <div className="history-controls__heading">
          <div><span className="sites-eyebrow">FORTYGUARD HISTORICAL ANALYSIS</span><h2>How does this site normally behave in heat?</h2><p>Analyze recurring spatial heat, continuous hot runs and the site's typical peak-time pattern.</p></div>
          <div className="history-provider-note"><Layers3 size={18} /><span><strong>3 shared FortyGuard calls</strong><small>Exceedance · Persistence · Time of Measure</small></span></div>
        </div>

        <div className="history-period-switch">
          {([7, 30, 90] as const).map((days) => <button type="button" key={days} className={period === days ? 'active' : ''} onClick={() => choosePeriod(days)}>Last {days} days</button>)}
          <button type="button" className={period === 'custom' ? 'active' : ''} onClick={() => choosePeriod('custom')}>Custom</button>
        </div>

        <div className="history-control-grid">
          <label><span>Start date</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPeriod('custom'); setResult(null) }} /></label>
          <label><span>End date</span><input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPeriod('custom'); setResult(null) }} /></label>
          <label><span>Heat threshold</span><div className="history-input-unit"><input type="number" min="-20" max="160" step="1" value={thresholdF} onChange={(event) => { setThresholdF(Number(event.target.value)); setResult(null) }} /><b>°F</b></div></label>
          <label><span>Cell resolution</span><select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value) as 60 | 80 | 100); setResult(null) }}><option value={60}>60 m · detailed</option><option value={80}>80 m</option><option value={100}>100 m · balanced</option></select></label>
        </div>

        <button className="button button--primary history-run" type="button" onClick={() => void run()} disabled={loading || !startDate || !endDate}>
          {loading ? <LoaderCircle className="history-spin" size={18} /> : <Flame size={18} />}
          {loading ? 'Analyzing FortyGuard history…' : 'Analyze Historical Heat'}
        </button>
        <p className="history-credit-note">One run requests three site-wide historical layers. Adding workers or zones does not create extra historical API calls.</p>
      </section>

      {!result && !loading && !error && (
        <section className="history-empty panel"><CalendarDays size={30} /><div><strong>Historical analysis has not been run</strong><p>Choose a period and threshold, then request the three FortyGuard historical layers. Results are not generated from current weather or synthetic estimates.</p></div></section>
      )}

      {error && <div className="history-error"><AlertTriangle size={17} /><span>{error}</span></div>}

      {result && result.dataStatus !== 'configuration_required' && (
        <>
          <section className="history-summary-grid">
            <article className="history-kpi panel"><span><Flame size={17} /> Heat Exceedance</span><strong>{formatNumber(result.maxExceedanceHours, ' h')}</strong><small>Maximum time above {result.thresholdF.toFixed(0)}°F in any sampled cell</small></article>
            <article className="history-kpi panel"><span><TimerReset size={17} /> Heat Persistence</span><strong>{formatNumber(result.maxPersistenceHours, ' h')}</strong><small>Longest continuous above-threshold run</small></article>
            <article className="history-kpi panel"><span><Clock3 size={17} /> Typical Peak</span><strong>{result.commonPeakPeriodLocal ?? '—'}</strong><small>Most common FortyGuard peak-time cell pattern</small></article>
            <article className="history-kpi panel"><span><Layers3 size={17} /> Evidence</span><strong>{result.cellCount}</strong><small>{result.providerRequestCount} provider requests · {result.cached ? 'cached' : `${result.dayCount}-day range`}</small></article>
          </section>

          <section className="history-map-panel panel">
            <div className="history-map-heading">
              <div><span className="sites-eyebrow">SPATIAL BEHAVIOR</span><h2>{metricTitle(metric)} Map</h2><p>{result.startDate} → {result.endDate} · threshold {result.thresholdF.toFixed(0)}°F ({result.thresholdC.toFixed(1)}°C)</p></div>
              <div className="history-layer-switch"><button className={metric === 'exceedance' ? 'active' : ''} onClick={() => setMetric('exceedance')}>Exceedance</button><button className={metric === 'persistence' ? 'active' : ''} onClick={() => setMetric('persistence')}>Persistence</button><button className={metric === 'peak' ? 'active' : ''} onClick={() => setMetric('peak')}>Peak time</button></div>
            </div>
            <HistoricalMap site={site} result={result} metric={metric} />
            <div className="history-map-legend"><span>Lower</span><i /><span>Higher</span><strong>{metric === 'peak' ? 'Earlier → later UTC peak hour' : `${metricUnit(metric)} across selected period`}</strong></div>
          </section>

          <div className="history-detail-grid">
            <section className="history-zones panel">
              <div className="report-section-heading"><div><span className="sites-eyebrow">ZONE COMPARISON</span><h2>Where Heat Accumulates</h2><p>Zone values are sampled at supervisor-defined zone centers against the shared FortyGuard historical grid.</p></div></div>
              {!result.zones.length ? <div className="history-zone-empty"><MapPinned size={21} /><span>No site zones exist yet. The whole-site cell map above still shows the spatial pattern.</span></div> : <div className="history-zone-table-wrap"><table className="history-zone-table"><thead><tr><th>Zone</th><th>Above threshold</th><th>Longest run</th><th>Typical peak</th><th>Evidence</th></tr></thead><tbody>{result.zones.map((zone, index) => <tr key={zone.zoneId}><td><strong>{zone.zoneName}</strong><small>{index === 0 && zone.exceedanceHours != null ? 'Highest sampled exceedance' : zone.zoneType}</small></td><td><strong>{formatNumber(zone.exceedanceHours, ' h')}</strong></td><td>{formatNumber(zone.persistenceHours, ' h')}</td><td>{zone.peakHourLocal ?? '—'}</td><td><span className={`history-evidence history-evidence--${zone.evidenceStatus}`}>{zone.evidenceStatus}</span></td></tr>)}</tbody></table></div>}
            </section>

            <aside className="history-insight panel">
              <span className="sites-eyebrow">OPERATIONAL INTERPRETATION</span>
              <h2>What this history means</h2>
              {topZone ? <p><strong>{topZone.zoneName}</strong> has the highest sampled exceedance among your defined zones at {formatNumber(topZone.exceedanceHours, ' hours')} above {result.thresholdF.toFixed(0)}°F during this period.</p> : <p>The provider returned site cells, but no supervisor-defined zone could be matched to a historical cell.</p>}
              <div className="history-insight-list">
                <div><Flame size={17} /><span><strong>Exceedance</strong><small>Total hours above the selected threshold. It measures accumulated heat exposure time, not degree-hours.</small></span></div>
                <div><TimerReset size={17} /><span><strong>Persistence</strong><small>Longest continuous run above the threshold. It distinguishes brief spikes from heat that holds.</small></span></div>
                <div><Clock3 size={17} /><span><strong>Time of Measure</strong><small>Hour-of-day when each tile reaches its peak. The summary reports the most common peak period across cells.</small></span></div>
              </div>
            </aside>
          </div>

          <section className="history-provenance panel">
            <div><CheckCircle2 size={19} /><span><strong>FortyGuard historical evidence</strong><small>{result.message ?? 'Historical analysis complete.'}</small></span></div>
            <div className="history-layer-statuses">{result.layers.map((item) => <span key={item.analyticType} className={`history-layer-status history-layer-status--${item.status}`}>{item.analyticType.replaceAll('_', ' ')} · {item.status} · {item.cellCount} cells</span>)}</div>
          </section>
        </>
      )}
    </div>
  )
}
