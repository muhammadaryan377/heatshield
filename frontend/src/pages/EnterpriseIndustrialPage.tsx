import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BatteryCharging,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Factory,
  Fan,
  Flame,
  Gauge,
  MapPin,
  RefreshCw,
  Server,
  ShieldCheck,
  Snowflake,
  ThermometerSun,
  Zap,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EnterpriseAssetMap } from '../components/enterprise/EnterpriseAssetMap'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { EnterpriseAsset, EnterpriseAssetExposure, EnterpriseAssetType } from '../types/asset'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../types/history'
import type { Coordinate, Site, SiteIntelligence, ThermalMapResponse, ThermalTile } from '../types/site'
import '../enterprise-assets.css'
import '../enterprise-industrial.css'

const STORAGE_KEY = 'heatshield:selected-site'
const HISTORY_MIN_DATE = '2019-01-01'
type Granularity = 60 | 80 | 100
type FacilityLens = 'data-center' | 'industrial'

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

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
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

function deriveExposure(
  asset: EnterpriseAsset,
  thermal: ThermalMapResponse | null,
  history: HistoricalHeatBehaviorResponse | null,
  thresholdC: number,
): EnterpriseAssetExposure {
  const thermalTile = thermal?.dataStatus === 'verified' ? findThermalTile(asset.coordinate, thermal.tiles) : null
  const historyCell = history && ['verified', 'partial'].includes(history.dataStatus)
    ? findHistoricalCell(asset.coordinate, history.cells)
    : null

  const latestTemperatureC = thermalTile?.temperatureC ?? null
  const exceedanceHours = historyCell?.exceedanceHours ?? null
  const persistenceHours = historyCell?.persistenceHours ?? null
  const hasThermal = latestTemperatureC != null
  const hasHistory = exceedanceHours != null || persistenceHours != null || historyCell?.peakHourLocal != null
  const evidenceState = hasThermal && hasHistory ? 'complete' : hasThermal ? 'thermal_only' : hasHistory ? 'historical_only' : 'unavailable'
  const heatLimitExceeded = asset.heatLimitC != null && latestTemperatureC != null && latestTemperatureC >= asset.heatLimitC

  if (!hasThermal && !hasHistory) {
    return {
      asset,
      evidenceState,
      latestTemperatureC,
      thermalTileId: thermalTile?.id ?? null,
      exceedanceHours,
      persistenceHours,
      peakHourLocal: historyCell?.peakHourLocal ?? null,
      heatLimitExceeded,
      riskScore: null,
      riskBand: 'unassessed',
      rationale: 'No verified FortyGuard spatial cell currently matches this asset coordinate.',
    }
  }

  const criticalityWeight = { low: 8, medium: 16, high: 26, critical: 36 }[asset.criticality]
  const temperatureContribution = latestTemperatureC == null
    ? 0
    : Math.max(0, Math.min(30, (latestTemperatureC - Math.min(thresholdC, 30)) * 2.2))
  const exceedanceContribution = Math.min(14, Math.max(0, exceedanceHours ?? 0) * 1.6)
  const persistenceContribution = Math.min(14, Math.max(0, persistenceHours ?? 0) * 2.2)
  const limitContribution = heatLimitExceeded ? 12 : 0
  const coolingContribution = asset.coolingDependent && latestTemperatureC != null && latestTemperatureC >= thresholdC ? 5 : 0
  const score = Math.round(Math.min(100, criticalityWeight + temperatureContribution + exceedanceContribution + persistenceContribution + limitContribution + coolingContribution))
  const riskBand = score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'low'

  return {
    asset,
    evidenceState,
    latestTemperatureC,
    thermalTileId: thermalTile?.id ?? null,
    exceedanceHours,
    persistenceHours,
    peakHourLocal: historyCell?.peakHourLocal ?? null,
    heatLimitExceeded,
    riskScore: score,
    riskBand,
    rationale: [
      `${asset.criticality} business criticality`,
      latestTemperatureC == null ? null : `${latestTemperatureC.toFixed(1)}°C matched surface cell`,
      exceedanceHours == null ? null : `${exceedanceHours.toFixed(1)} h above threshold`,
      persistenceHours == null ? null : `${persistenceHours.toFixed(1)} h persistence`,
      heatLimitExceeded ? `configured ${asset.heatLimitC?.toFixed(1)}°C limit exceeded` : null,
    ].filter(Boolean).join(' · '),
  }
}

function temperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function percent(value?: number | null) {
  return value == null ? '—' : `${Math.round(value)}%`
}

function assetTypeLabel(type: EnterpriseAssetType) {
  return type.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase())
}

function assetTypeIcon(type: EnterpriseAssetType) {
  if (type === 'transformer' || type === 'ups') return Zap
  if (type === 'hvac' || type === 'cooling_tower') return Fan
  if (type === 'chiller' || type === 'server_room') return Snowflake
  if (type === 'generator') return BatteryCharging
  return Factory
}

function riskLabel(exposure: EnterpriseAssetExposure) {
  return exposure.riskBand === 'unassessed' ? 'Unassessed' : exposure.riskBand.charAt(0).toUpperCase() + exposure.riskBand.slice(1)
}

function operationalAction(exposure: EnterpriseAssetExposure) {
  const type = exposure.asset.type
  if (exposure.riskBand === 'unassessed') return 'Refresh spatial evidence before changing operations for this asset.'
  if (exposure.heatLimitExceeded) return 'Verify equipment operating margin and inspect local cooling or ventilation before the next peak window.'
  if (type === 'transformer') return 'Review transformer thermal margin, ventilation clearance and load during the returned peak period.'
  if (type === 'generator') return 'Check generator intake/exhaust heat exposure and avoid nonessential testing during the peak period.'
  if (type === 'chiller' || type === 'cooling_tower' || type === 'hvac') return 'Verify cooling capacity and intake conditions during the highest-exposure window.'
  if (type === 'ups' || type === 'server_room') return 'Review cooling redundancy and temperature margin for this critical digital infrastructure.'
  return 'Inspect local heat drivers and keep this asset in the engineering monitoring queue.'
}

function inferLens(assets: EnterpriseAsset[]): FacilityLens {
  const dataCenterSignals = assets.filter((asset) => ['server_room', 'ups', 'chiller', 'cooling_tower'].includes(asset.type)).length
  return dataCenterSignals >= 2 ? 'data-center' : 'industrial'
}

export function EnterpriseIndustrialPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [assets, setAssets] = useState<EnterpriseAsset[]>([])
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [history, setHistory] = useState<HistoricalHeatBehaviorResponse | null>(null)
  const [intelligence, setIntelligence] = useState<SiteIntelligence | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [analysisDate, setAnalysisDate] = useState(defaultAnalysisDate)
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [facilityLens, setFacilityLens] = useState<FacilityLens>('industrial')
  const [sitesLoading, setSitesLoading] = useState(true)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites])

  const runAnalysis = useCallback(async (siteId: string, date: string, threshold: number, resolution: Granularity) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setAnalysisLoading(true)
    setError(null)

    const [assetResult, thermalResult, historyResult, intelligenceResult] = await Promise.allSettled([
      api.listEnterpriseAssets(siteId, controller.signal),
      api.generateThermalMap(siteId, { mode: 'site', granularityMeters: resolution }, controller.signal),
      api.generateHistoricalHeatBehavior(siteId, {
        startDate: date,
        endDate: date,
        thresholdF: celsiusToFahrenheit(threshold),
        granularityMeters: resolution,
      }, controller.signal),
      api.getSiteIntelligence(siteId, controller.signal),
    ])

    if (controller.signal.aborted) return
    const messages: string[] = []

    if (assetResult.status === 'fulfilled') {
      setAssets(assetResult.value)
      setFacilityLens(inferLens(assetResult.value))
      setSelectedAssetId((current) => current && assetResult.value.some((asset) => asset.id === current)
        ? current
        : assetResult.value[0]?.id ?? null)
    } else if (!isAbortError(assetResult.reason, controller.signal)) {
      setAssets([])
      messages.push(assetResult.reason instanceof Error ? assetResult.reason.message : 'Asset registry could not be loaded.')
    }

    if (thermalResult.status === 'fulfilled') {
      setThermal(thermalResult.value)
      if (thermalResult.value.dataStatus !== 'verified' && thermalResult.value.message) messages.push(thermalResult.value.message)
    } else if (!isAbortError(thermalResult.reason, controller.signal)) {
      setThermal(null)
      messages.push(thermalResult.reason instanceof Error ? thermalResult.reason.message : 'Latest FortyGuard thermal layer could not be loaded.')
    }

    if (historyResult.status === 'fulfilled') {
      setHistory(historyResult.value)
      if (['unavailable', 'configuration_required'].includes(historyResult.value.dataStatus) && historyResult.value.message) {
        messages.push(historyResult.value.message)
      }
    } else if (!isAbortError(historyResult.reason, controller.signal)) {
      setHistory(null)
      messages.push(historyResult.reason instanceof Error ? historyResult.reason.message : 'Historical exposure analysis could not be loaded.')
    }

    if (intelligenceResult.status === 'fulfilled') {
      setIntelligence(intelligenceResult.value)
    } else if (!isAbortError(intelligenceResult.reason, controller.signal)) {
      setIntelligence(null)
      messages.push(intelligenceResult.reason instanceof Error ? intelligenceResult.reason.message : 'Atmospheric context could not be loaded.')
    }

    setError(messages.length ? messages.join(' ') : null)
    setAnalysisLoading(false)
  }, [])

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    setSitesLoading(true)
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
          void runAnalysis(preferred, analysisDate, thresholdC, granularity)
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load enterprise sites.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setSitesLoading(false)
      })
    return () => controller.abort()
    // Initial request intentionally uses default analysis controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const appliedDate = history?.startDate ?? analysisDate
  const appliedThresholdC = history?.thresholdC ?? thresholdC
  const appliedGranularity = (history?.granularityMeters ?? granularity) as Granularity
  const controlsChanged = Boolean(history) && (
    analysisDate !== appliedDate
    || Math.abs(thresholdC - appliedThresholdC) > 0.001
    || granularity !== appliedGranularity
  )

  const exposures = useMemo(
    () => assets.map((asset) => deriveExposure(asset, thermal, history, appliedThresholdC)),
    [appliedThresholdC, assets, history, thermal],
  )

  const ranked = useMemo(() => [...exposures]
    .sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1)), [exposures])

  const selectedExposure = useMemo(
    () => exposures.find((item) => item.asset.id === selectedAssetId) ?? ranked[0] ?? null,
    [exposures, ranked, selectedAssetId],
  )

  const assessed = exposures.filter((item) => item.riskBand !== 'unassessed')
  const highRisk = assessed.filter((item) => item.riskBand === 'high' || item.riskBand === 'critical')
  const criticalInfra = exposures.filter((item) => item.asset.criticality === 'critical' || ['transformer', 'generator', 'ups', 'server_room', 'chiller', 'cooling_tower'].includes(item.asset.type))
  const criticalInfraAtRisk = criticalInfra.filter((item) => item.riskBand === 'high' || item.riskBand === 'critical')
  const coolingAssets = exposures.filter((item) => item.asset.coolingDependent || ['hvac', 'chiller', 'cooling_tower', 'server_room'].includes(item.asset.type))
  const coolingAssessed = coolingAssets.filter((item) => item.riskScore != null)
  const coolingExposureScore = coolingAssessed.length
    ? Math.round(coolingAssessed.reduce((sum, item) => sum + (item.riskScore ?? 0), 0) / coolingAssessed.length)
    : null
  const backupAssets = exposures.filter((item) => item.asset.type === 'generator' || item.asset.type === 'ups')
  const backupAtRisk = backupAssets.filter((item) => item.riskBand === 'high' || item.riskBand === 'critical')
  const limitBreaches = exposures.filter((item) => item.heatLimitExceeded)
  const coverage = assets.length ? assessed.length / assets.length * 100 : null
  const peakWindow = history?.commonPeakPeriodLocal ?? history?.commonPeakHourLocal ?? 'Evidence unavailable'
  const facilityScore = assessed.length
    ? Math.round((Math.max(...assessed.map((item) => item.riskScore ?? 0)) * 0.6) + (assessed.reduce((sum, item) => sum + (item.riskScore ?? 0), 0) / assessed.length * 0.4))
    : null
  const facilityBand = facilityScore == null ? 'unassessed' : facilityScore >= 75 ? 'critical' : facilityScore >= 55 ? 'high' : facilityScore >= 35 ? 'medium' : 'low'

  const mitigationQueue = ranked.filter((item) => item.riskBand !== 'unassessed').slice(0, 5)
  const alerts = [
    ...limitBreaches.map((item) => ({
      title: `${item.asset.name} exceeds configured thermal limit`,
      detail: `${temperature(item.latestTemperatureC)} matched against ${temperature(item.asset.heatLimitC)} configured limit.`,
      tone: 'critical' as const,
    })),
    ...criticalInfraAtRisk.filter((item) => !item.heatLimitExceeded).map((item) => ({
      title: `${item.asset.name} is ${item.riskBand} priority`,
      detail: `${item.asset.assetCode} · ${hours(item.persistenceHours)} persistence · ${item.peakHourLocal ?? 'peak time unavailable'}.`,
      tone: 'warning' as const,
    })),
  ].slice(0, 5)

  const outlook = intelligence?.forecast?.slice(0, 8) ?? []
  const noOpPick = useCallback((_coordinate: Coordinate): void => {}, [])

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setAssets([])
    setThermal(null)
    setHistory(null)
    setIntelligence(null)
    setSelectedAssetId(null)
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    void runAnalysis(siteId, analysisDate, thresholdC, granularity)
  }

  const submitAnalysis = (event: FormEvent) => {
    event.preventDefault()
    if (selectedSiteId) void runAnalysis(selectedSiteId, analysisDate, thresholdC, granularity)
  }

  const maxDate = defaultAnalysisDate()

  return (
    <AppShell module="enterprise">
      <header className="industrial-topbar">
        <div>
          <h1>Data Center / Industrial Analysis</h1>
          <span>Translate verified site heat and asset exposure into facility operating decisions.</span>
        </div>
        <div className="industrial-topbar__spacer" />
        <div className="industrial-core">
          <span />
          <div><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard evidence core</strong></div>
        </div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="industrial-page">
        {sitesLoading && <StatePanel kind="loading" title="Loading Industrial Intelligence" detail="Reading enterprise sites, asset registry and evidence configuration…" />}

        {!sitesLoading && !sites.length && (
          <section className="industrial-empty panel">
            <Building2 size={28} />
            <div><strong>Enterprise site required</strong><p>Add a site boundary before industrial heat analysis can be run.</p></div>
            <Link to="/enterprise/sites" className="button button--primary">Open Sites</Link>
          </section>
        )}

        {selectedSite && (
          <>
            <section className="industrial-controls panel">
              <div className="industrial-controls__site">
                <span>FACILITY</span>
                <label><MapPin size={17} /><select value={selectedSite.id} onChange={(event) => selectSite(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                <small>{selectedSite.address}</small>
              </div>

              <div className="industrial-lens" role="group" aria-label="Facility analysis lens">
                <button type="button" className={facilityLens === 'data-center' ? 'active' : ''} onClick={() => setFacilityLens('data-center')}><Server size={16} /> Data Center</button>
                <button type="button" className={facilityLens === 'industrial' ? 'active' : ''} onClick={() => setFacilityLens('industrial')}><Factory size={16} /> Industrial</button>
              </div>

              <form onSubmit={submitAnalysis} className="industrial-controls__form">
                <label><span>Completed day</span><div><CalendarDays size={15} /><input type="date" min={HISTORY_MIN_DATE} max={maxDate} value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} /></div></label>
                <label><span>Heat threshold</span><div><ThermometerSun size={15} /><input type="number" min="20" max="55" step="0.5" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /><b>°C</b></div></label>
                <label><span>Resolution</span><div><Database size={15} /><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as Granularity)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></div></label>
                <button className="button button--primary" type="submit" disabled={analysisLoading}>{analysisLoading ? <RefreshCw className="spin" size={16} /> : <Activity size={16} />}{analysisLoading ? 'Analyzing…' : controlsChanged ? 'Re-run Facility Analysis' : 'Run Facility Analysis'}</button>
              </form>
            </section>

            <div className="industrial-evidence-note"><ShieldCheck size={16} /><span><strong>Evidence model:</strong> latest surface temperature is verified FortyGuard TCM; persistence/exceedance use the last applied completed day ({appliedDate}). Facility and cooling scores are HeatShield-derived operational proxies, not provider measurements.</span></div>
            {controlsChanged && <div className="industrial-warning"><AlertTriangle size={16} /><span>Facility controls changed. Current scores still use {appliedDate}, {appliedThresholdC.toFixed(1)}°C and {appliedGranularity} m until you re-run the analysis.</span></div>}
            {error && <div className="industrial-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="industrial-kpis" aria-label="Industrial heat intelligence summary">
              <article><span><Gauge size={17} /> Facility Thermal Posture</span><strong className={`risk-${facilityBand}`}>{facilityScore == null ? '—' : `${facilityScore}/100`}</strong><small>{facilityBand === 'unassessed' ? 'Needs matched asset evidence' : `HeatShield-derived · ${facilityBand}`}</small></article>
              <article><span><ThermometerSun size={17} /> Peak Site Surface</span><strong>{temperature(thermal?.maxTemperatureC)}</strong><small>{thermal?.dataStatus === 'verified' ? `${thermal.tileCount} verified cells` : 'No synthetic heat shown'}</small></article>
              <article><span><Snowflake size={17} /> Cooling Exposure Proxy</span><strong>{coolingExposureScore == null ? '—' : `${coolingExposureScore}/100`}</strong><small>{coolingAssets.length ? `${coolingAssessed.length}/${coolingAssets.length} cooling-related assets assessed` : 'No cooling-related assets registered'}</small></article>
              <article><span><Zap size={17} /> Critical Infrastructure</span><strong>{criticalInfraAtRisk.length}</strong><small>{criticalInfra.length} registered critical / power / cooling assets</small></article>
              <article><span><Flame size={17} /> Max Heat Persistence</span><strong>{hours(history?.maxPersistenceHours)}</strong><small>{appliedDate} completed day</small></article>
              <article><span><Clock3 size={17} /> Operational Risk Window</span><strong className="industrial-kpis__window">{peakWindow}</strong><small>Common FortyGuard peak period</small></article>
              <article><span><BatteryCharging size={17} /> Backup Equipment Exposure</span><strong>{backupAtRisk.length}</strong><small>{backupAssets.length ? `${backupAssets.length} generator / UPS assets registered` : 'Add generator or UPS assets to assess'}</small></article>
            </section>

            <section className="industrial-main-grid">
              <EnterpriseAssetMap
                site={selectedSite}
                exposures={exposures}
                thermal={thermal}
                selectedAssetId={selectedExposure?.asset.id ?? null}
                placementMode={false}
                pendingCoordinate={null}
                onSelectAsset={setSelectedAssetId}
                onPickCoordinate={noOpPick}
              />

              <aside className="industrial-side panel">
                <div className="industrial-side__head"><span>OPERATIONS</span><h2>Operational Risk Window</h2><p>Use the returned peak-time and persistence evidence to plan inspections and nonessential work.</p></div>
                <div className="industrial-window-card">
                  <Clock3 size={20} />
                  <div><span>Common peak period</span><strong>{peakWindow}</strong><small>{history?.dataStatus === 'verified' || history?.dataStatus === 'partial' ? `${appliedDate} · ${appliedThresholdC.toFixed(1)}°C threshold` : 'Historical layer unavailable'}</small></div>
                </div>
                <div className="industrial-side__metrics">
                  <div><span>Mean exceedance</span><strong>{hours(history?.meanExceedanceHours)}</strong></div>
                  <div><span>Max persistence</span><strong>{hours(history?.maxPersistenceHours)}</strong></div>
                  <div><span>Asset evidence coverage</span><strong>{percent(coverage)}</strong></div>
                  <div><span>Heat-index context</span><strong>{temperature(intelligence?.conditions?.heatIndexC)}</strong></div>
                </div>
                <div className="industrial-side__source"><Database size={15} /><span>Atmospheric heat index is contextual only. It does not replace surface heat evidence.</span></div>
              </aside>
            </section>

            <section className="industrial-section-grid">
              <article className="industrial-panel panel">
                <div className="industrial-panel__head"><div><span>INFRASTRUCTURE</span><h2>Critical Infrastructure</h2></div><Link to={`/enterprise/assets?site=${selectedSite.id}`}>Manage assets <ArrowRight size={15} /></Link></div>
                {!criticalInfra.length ? <div className="industrial-panel__empty">Register transformers, cooling systems, generators, UPS or server rooms in Asset Intelligence.</div> : (
                  <div className="industrial-infra-list">
                    {criticalInfra.slice(0, 7).map((item) => {
                      const Icon = assetTypeIcon(item.asset.type)
                      return <button type="button" key={item.asset.id} onClick={() => setSelectedAssetId(item.asset.id)} className={selectedExposure?.asset.id === item.asset.id ? 'active' : ''}>
                        <span className={`industrial-infra-icon risk-${item.riskBand}`}><Icon size={16} /></span>
                        <div><strong>{item.asset.name}</strong><small>{item.asset.assetCode} · {assetTypeLabel(item.asset.type)}</small></div>
                        <div className="industrial-infra-evidence"><b>{temperature(item.latestTemperatureC)}</b><small>{hours(item.persistenceHours)} persistence</small></div>
                        <span className={`risk-pill risk-${item.riskBand}`}>{riskLabel(item)}</span>
                      </button>
                    })}
                  </div>
                )}
              </article>

              <article className="industrial-panel panel">
                <div className="industrial-panel__head"><div><span>ENGINEERING QUEUE</span><h2>Mitigation Priority</h2></div><strong>{mitigationQueue.length} assessed</strong></div>
                {!mitigationQueue.length ? <div className="industrial-panel__empty">No asset has enough matched evidence to create a mitigation queue yet.</div> : (
                  <ol className="industrial-priority-list">
                    {mitigationQueue.map((item, index) => <li key={item.asset.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div><strong>{item.asset.name}</strong><small>{operationalAction(item)}</small></div>
                      <b>{item.riskScore}/100</b>
                    </li>)}
                  </ol>
                )}
              </article>
            </section>

            <section className="industrial-section-grid industrial-section-grid--bottom">
              <article className="industrial-panel panel">
                <div className="industrial-panel__head"><div><span>COOLING SYSTEM IMPACT</span><h2>{facilityLens === 'data-center' ? 'Cooling & Digital Infrastructure' : 'Cooling & Process Support'}</h2></div><strong>{coolingAssets.length} assets</strong></div>
                {!coolingAssets.length ? <div className="industrial-panel__empty">No cooling-dependent assets are registered. Add HVAC, chillers, cooling towers or cooling-dependent equipment in Asset Intelligence.</div> : (
                  <div className="industrial-cooling-grid">
                    {coolingAssets.slice(0, 6).map((item) => <div key={item.asset.id}>
                      <span>{assetTypeLabel(item.asset.type)}</span>
                      <strong>{item.asset.name}</strong>
                      <small>{temperature(item.latestTemperatureC)} · {hours(item.persistenceHours)}</small>
                      <i><b style={{ width: `${item.riskScore ?? 0}%` }} /></i>
                      <em>{item.riskScore == null ? 'Unassessed' : `${item.riskScore}/100 exposure proxy`}</em>
                    </div>)}
                  </div>
                )}
              </article>

              <article className="industrial-panel panel">
                <div className="industrial-panel__head"><div><span>THERMAL ALERTS</span><h2>Evidence-Backed Attention</h2></div><strong>{alerts.length}</strong></div>
                {!alerts.length ? <div className="industrial-panel__empty"><CheckCircle2 size={18} /> No configured limit breach or high-priority critical infrastructure is currently returned.</div> : (
                  <div className="industrial-alert-list">{alerts.map((alert, index) => <div className={alert.tone} key={`${alert.title}-${index}`}><AlertTriangle size={16} /><div><strong>{alert.title}</strong><span>{alert.detail}</span></div></div>)}</div>
                )}
              </article>
            </section>

            <section className="industrial-section-grid industrial-section-grid--bottom">
              <article className="industrial-panel panel">
                <div className="industrial-panel__head"><div><span>ATMOSPHERIC OUTLOOK</span><h2>Operating Context</h2></div><small>Context only</small></div>
                {!outlook.length ? <div className="industrial-panel__empty">No atmospheric forecast points are available from the current site-intelligence source.</div> : (
                  <div className="industrial-outlook">
                    {outlook.map((point) => <div key={point.time}><span>{point.time}</span><i style={{ height: `${Math.max(14, Math.min(76, point.temperatureC * 1.7))}px` }} /><strong>{point.temperatureC.toFixed(1)}°</strong></div>)}
                  </div>
                )}
                <p className="industrial-context-note">This chart is atmospheric context from {intelligence?.conditionSourceLabel ?? 'the configured site-intelligence source'}; it is not a FortyGuard future surface-temperature map.</p>
              </article>

              <article className="industrial-panel panel">
                <div className="industrial-panel__head"><div><span>SELECTED ASSET</span><h2>{selectedExposure?.asset.name ?? 'Select infrastructure'}</h2></div>{selectedExposure && <span className={`risk-pill risk-${selectedExposure.riskBand}`}>{riskLabel(selectedExposure)}</span>}</div>
                {!selectedExposure ? <div className="industrial-panel__empty">Select an infrastructure marker to inspect its operational heat context.</div> : (
                  <div className="industrial-selected">
                    <div><span>Latest surface</span><strong>{temperature(selectedExposure.latestTemperatureC)}</strong></div>
                    <div><span>Persistence</span><strong>{hours(selectedExposure.persistenceHours)}</strong></div>
                    <div><span>Exceedance</span><strong>{hours(selectedExposure.exceedanceHours)}</strong></div>
                    <div><span>Peak period</span><strong>{selectedExposure.peakHourLocal ?? '—'}</strong></div>
                    <div><span>Criticality</span><strong>{selectedExposure.asset.criticality}</strong></div>
                    <div><span>Configured limit</span><strong>{temperature(selectedExposure.asset.heatLimitC)}</strong></div>
                    <div className="industrial-selected__action"><span>Recommended engineering review</span><p>{operationalAction(selectedExposure)}</p></div>
                    <div className="industrial-selected__why"><ShieldCheck size={15} /><span>{selectedExposure.rationale}</span></div>
                  </div>
                )}
              </article>
            </section>

            <section className="industrial-provenance panel">
              <div><ShieldCheck size={19} /><span><strong>Evidence provenance</strong><small>Provider measurements and HeatShield-derived operational interpretation remain separated.</small></span></div>
              <div className="industrial-provenance__items">
                <span><b>Latest surface</b>{thermal?.dataStatus === 'verified' ? `FortyGuard · ${thermal.tileCount} cells` : 'Unavailable'}</span>
                <span><b>Historical exposure</b>{history?.dataStatus ?? 'Unavailable'} · {appliedDate} · {appliedThresholdC.toFixed(1)}°C · {appliedGranularity} m · {history?.providerRequestCount ?? 0} provider requests</span>
                <span><b>Asset registry</b>{assets.length} HeatShield enterprise assets</span>
                <span><b>Facility score</b>HeatShield-derived operational proxy</span>
              </div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
