import {
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  Database,
  Fan,
  Flame,
  Gauge,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Snowflake,
  ThermometerSun,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EnterpriseAssetMap } from '../components/enterprise/EnterpriseAssetMap'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type {
  EnterpriseAsset,
  EnterpriseAssetCreate,
  EnterpriseAssetExposure,
  EnterpriseAssetType,
} from '../types/asset'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../types/history'
import type { Coordinate, Site, SiteIntelligence, ThermalMapResponse, ThermalTile } from '../types/site'
import '../enterprise-assets.css'

const STORAGE_KEY = 'heatshield:selected-site'
const HISTORY_MIN_DATE = '2019-01-01'
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
    if (pointOnSegment(point, polygon[index - 1 < 0 ? polygon.length - 1 : index - 1], polygon[index])) return true
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

function assetTypeLabel(type: EnterpriseAssetType) {
  return type.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase())
}

function assetIcon(type: EnterpriseAssetType) {
  if (type === 'transformer' || type === 'ups') return Zap
  if (type === 'hvac' || type === 'cooling_tower') return Fan
  if (type === 'chiller' || type === 'server_room') return Snowflake
  return Box
}

function temperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function formatObserved(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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
      rationale: 'No verified FortyGuard cell currently matches this asset coordinate.',
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

  const reasons = [
    `${asset.criticality} business criticality`,
    latestTemperatureC == null ? null : `${latestTemperatureC.toFixed(1)}°C matched surface cell`,
    exceedanceHours == null ? null : `${exceedanceHours.toFixed(1)} h above ${thresholdC.toFixed(1)}°C`,
    persistenceHours == null ? null : `${persistenceHours.toFixed(1)} h longest continuous run`,
    heatLimitExceeded ? `configured ${asset.heatLimitC?.toFixed(1)}°C limit exceeded` : null,
  ].filter(Boolean)

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
    rationale: reasons.join(' · '),
  }
}

function recommendedAction(exposure: EnterpriseAssetExposure) {
  if (exposure.riskBand === 'unassessed') return 'Move the asset coordinate inside verified FortyGuard coverage or refresh evidence before prioritizing mitigation.'
  if (exposure.heatLimitExceeded) return 'Review the asset operating limit, inspect local cooling/ventilation conditions, and prioritize mitigation for this location.'
  if (exposure.riskBand === 'critical') return 'Schedule an engineering review before the next peak period and verify thermal operating margin for this critical asset.'
  if (exposure.riskBand === 'high') return 'Inspect local heat drivers and cooling capacity; compare targeted shading, surface treatment, or equipment protection options.'
  if (exposure.asset.coolingDependent) return 'Verify cooling performance during the returned peak window and keep this asset in the priority monitoring set.'
  return 'Continue monitoring and re-run exposure analysis when conditions or operating requirements change.'
}

interface AssetDraft {
  assetCode: string
  name: string
  type: EnterpriseAssetType
  criticality: EnterpriseAsset['criticality']
  status: EnterpriseAsset['status']
  heatLimitC: string
  coolingDependent: boolean
  owner: string
  notes: string
  coordinate: Coordinate
}

function freshDraft(site: Site): AssetDraft {
  return {
    assetCode: '',
    name: '',
    type: 'transformer',
    criticality: 'high',
    status: 'operational',
    heatLimitC: '',
    coolingDependent: false,
    owner: '',
    notes: '',
    coordinate: site.center,
  }
}

export function EnterpriseAssetsPage() {
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
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low' | 'unassessed'>('all')
  const [sitesLoading, setSitesLoading] = useState(true)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assetFormOpen, setAssetFormOpen] = useState(false)
  const [assetSaving, setAssetSaving] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [placementConfirmed, setPlacementConfirmed] = useState(false)
  const [draft, setDraft] = useState<AssetDraft | null>(null)
  const requestRef = useRef<AbortController | null>(null)

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites])

  const runEvidence = useCallback(async (siteId: string, date: string, threshold: number, resolution: Granularity) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setEvidenceLoading(true)
    setError(null)

    const [assetsResult, thermalResult, historyResult, intelligenceResult] = await Promise.allSettled([
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

    if (assetsResult.status === 'fulfilled') setAssets(assetsResult.value)
    else if (!isAbortError(assetsResult.reason, controller.signal)) messages.push(assetsResult.reason instanceof Error ? assetsResult.reason.message : 'Asset registry could not be loaded.')

    if (thermalResult.status === 'fulfilled') {
      setThermal(thermalResult.value)
      if (thermalResult.value.dataStatus !== 'verified' && thermalResult.value.message) messages.push(thermalResult.value.message)
    } else if (!isAbortError(thermalResult.reason, controller.signal)) {
      setThermal(null)
      messages.push(thermalResult.reason instanceof Error ? thermalResult.reason.message : 'Latest FortyGuard spatial layer could not be loaded.')
    }

    if (historyResult.status === 'fulfilled') {
      setHistory(historyResult.value)
      if (historyResult.value.dataStatus === 'configuration_required' || historyResult.value.dataStatus === 'unavailable') {
        if (historyResult.value.message) messages.push(historyResult.value.message)
      }
    } else if (!isAbortError(historyResult.reason, controller.signal)) {
      setHistory(null)
      messages.push(historyResult.reason instanceof Error ? historyResult.reason.message : 'Historical asset exposure evidence could not be loaded.')
    }

    if (intelligenceResult.status === 'fulfilled') setIntelligence(intelligenceResult.value)
    else if (!isAbortError(intelligenceResult.reason, controller.signal)) messages.push('Atmospheric context is unavailable; spatial asset evidence remains separate.')

    setError(messages.length ? messages.join(' ') : null)
    setEvidenceLoading(false)
  }, [])

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    if (!assetFormOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !assetSaving) {
        setAssetFormOpen(false)
        setDraft(null)
        setPlacementConfirmed(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [assetFormOpen, assetSaving])

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
          void runEvidence(preferred, analysisDate, thresholdC, granularity)
        }
      })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load enterprise sites.') })
      .finally(() => { if (!controller.signal.aborted) setSitesLoading(false) })
    return () => controller.abort()
    // Initial load uses default analysis controls; later changes are explicit.
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

  useEffect(() => {
    if (selectedAssetId && exposures.some((item) => item.asset.id === selectedAssetId)) return
    const priority = [...exposures]
      .sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1))[0]
    setSelectedAssetId(priority?.asset.id ?? null)
  }, [exposures, selectedAssetId])

  const selectedExposure = useMemo(() => exposures.find((item) => item.asset.id === selectedAssetId) ?? null, [exposures, selectedAssetId])
  const filteredExposures = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return exposures.filter((item) => {
      const matchesSearch = !needle || `${item.asset.name} ${item.asset.assetCode} ${item.asset.type} ${item.asset.owner ?? ''}`.toLowerCase().includes(needle)
      const matchesRisk = riskFilter === 'all' || item.riskBand === riskFilter
      return matchesSearch && matchesRisk
    })
  }, [exposures, riskFilter, search])

  const assessed = exposures.filter((item) => item.riskScore != null)
  const highRisk = exposures.filter((item) => item.riskBand === 'high' || item.riskBand === 'critical').length
  const criticalAssets = assets.filter((asset) => asset.criticality === 'critical').length
  const coolingDependent = assets.filter((asset) => asset.coolingDependent).length
  const limitBreaches = exposures.filter((item) => item.heatLimitExceeded).length
  const evidenceCoverage = assets.length ? Math.round(assessed.length / assets.length * 100) : 0
  const topPriority = [...exposures].sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1)).slice(0, 4)

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setAssets([])
    setThermal(null)
    setHistory(null)
    setIntelligence(null)
    setSelectedAssetId(null)
    setAssetFormOpen(false)
    setDraft(null)
    setPlacementConfirmed(false)
    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    void runEvidence(siteId, analysisDate, thresholdC, granularity)
  }

  const refresh = () => {
    if (selectedSiteId) void runEvidence(selectedSiteId, analysisDate, thresholdC, granularity)
  }

  const closeAssetForm = () => {
    if (assetSaving) return
    setAssetFormOpen(false)
    setDraft(null)
    setPlacementConfirmed(false)
    setAssetError(null)
  }

  const openAssetForm = () => {
    if (!selectedSite) return
    setDraft(freshDraft(selectedSite))
    setAssetError(null)
    setPlacementConfirmed(false)
    setAssetFormOpen(true)
  }

  const pickCoordinate = useCallback((coordinate: Coordinate) => {
    if (!assetFormOpen || !selectedSite) return
    if (!pointInPolygon(coordinate, selectedSite.polygon)) {
      setPlacementConfirmed(false)
      setAssetError('Choose a point inside the saved site boundary.')
      return
    }
    setAssetError(null)
    setPlacementConfirmed(true)
    setDraft((current) => current ? { ...current, coordinate } : current)
  }, [assetFormOpen, selectedSite])

  const submitAsset = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedSite || !draft || !draft.name.trim()) return
    if (!placementConfirmed) {
      setAssetError('Place the asset on the site map before saving. HeatShield will not assume a location.')
      return
    }
    if (!pointInPolygon(draft.coordinate, selectedSite.polygon)) {
      setPlacementConfirmed(false)
      setAssetError('The selected asset point is outside the saved site boundary.')
      return
    }

    setAssetSaving(true)
    setAssetError(null)
    const payload: EnterpriseAssetCreate = {
      assetCode: draft.assetCode.trim() || undefined,
      name: draft.name.trim(),
      type: draft.type,
      coordinate: draft.coordinate,
      criticality: draft.criticality,
      status: draft.status,
      heatLimitC: draft.heatLimitC.trim() ? Number(draft.heatLimitC) : null,
      coolingDependent: draft.coolingDependent,
      owner: draft.owner.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    }
    try {
      const created = await api.createEnterpriseAsset(selectedSite.id, payload)
      setAssets((current) => [created, ...current])
      setSelectedAssetId(created.id)
      setAssetFormOpen(false)
      setDraft(null)
      setPlacementConfirmed(false)
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : 'Unable to create asset.')
    } finally {
      setAssetSaving(false)
    }
  }

  const deleteSelectedAsset = async () => {
    if (!selectedSite || !selectedExposure) return
    if (!window.confirm(`Remove ${selectedExposure.asset.name} from this site?`)) return
    try {
      await api.deleteEnterpriseAsset(selectedSite.id, selectedExposure.asset.id)
      setAssets((current) => current.filter((asset) => asset.id !== selectedExposure.asset.id))
      setSelectedAssetId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove asset.')
    }
  }

  const maxDate = defaultAnalysisDate()

  return (
    <AppShell module="enterprise">
      <header className="enterprise-assets-topbar">
        <div><h1>Asset Intelligence</h1><span>Connect critical infrastructure to verified property heat evidence and prioritize engineering attention.</span></div>
        <div className="enterprise-assets-topbar__spacer" />
        <div className="enterprise-assets-core"><span /><div><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard evidence + asset context</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="enterprise-assets-page">
        {sitesLoading && <StatePanel kind="loading" title="Loading Asset Intelligence" detail="Reading enterprise properties and infrastructure registry…" />}

        {!sitesLoading && !sites.length && (
          <section className="enterprise-assets-empty panel"><Box size={30} /><div><h2>Add a property before registering assets</h2><p>Asset exposure needs a real saved site polygon so equipment can be spatially matched to FortyGuard evidence.</p></div><Link to="/enterprise/sites" className="button button--primary">Open Sites</Link></section>
        )}

        {selectedSite && (
          <>
            <section className="enterprise-assets-controls panel">
              <div className="enterprise-assets-controls__site">
                <span>PROPERTY</span>
                <label><MapPin size={17} /><select value={selectedSite.id} onChange={(event) => selectSite(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                <small>{selectedSite.address}</small>
              </div>
              <div className="enterprise-assets-controls__evidence">
                <label><span>Exposure day</span><input type="date" min={HISTORY_MIN_DATE} max={maxDate} value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} /></label>
                <label><span>Threshold °C</span><input type="number" min="20" max="55" step="0.5" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /></label>
                <label><span>Resolution</span><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as Granularity)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></label>
                <button type="button" className="button button--secondary" onClick={refresh} disabled={evidenceLoading}>{evidenceLoading ? <RefreshCw className="spin" size={16} /> : <Database size={16} />}{evidenceLoading ? 'Refreshing…' : controlsChanged ? 'Apply & Refresh' : 'Refresh Evidence'}</button>
                <button type="button" className="button button--primary" onClick={openAssetForm}><Plus size={16} /> Add Asset</button>
              </div>
            </section>

            <div className="enterprise-assets-source-note"><ShieldCheck size={15} /><span><strong>Evidence boundary:</strong> FortyGuard supplies spatial heat evidence. Asset criticality, limits and the HeatShield risk score are enterprise context and derived interpretation, not provider measurements.</span></div>
            {controlsChanged && <div className="enterprise-assets-warning"><AlertTriangle size={16} /><span>Evidence controls changed. Current asset scores still use {appliedDate}, {appliedThresholdC.toFixed(1)}°C and {appliedGranularity} m until you refresh.</span></div>}
            {error && <div className="enterprise-assets-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="enterprise-assets-kpis" aria-label="Asset intelligence metrics">
              <article><span><Box size={17} /> Registered Assets</span><strong>{assets.length}</strong><small>{criticalAssets} business-critical</small></article>
              <article><span><ShieldCheck size={17} /> Evidence Coverage</span><strong>{assets.length ? `${evidenceCoverage}%` : '—'}</strong><small>{assessed.length} assets matched to verified evidence</small></article>
              <article><span><Flame size={17} /> High / Critical Risk</span><strong>{highRisk}</strong><small>HeatShield derived asset priority</small></article>
              <article><span><ThermometerSun size={17} /> Limit Breaches</span><strong>{limitBreaches}</strong><small>Configured equipment limits vs latest matched cell</small></article>
              <article><span><Snowflake size={17} /> Cooling Dependent</span><strong>{coolingDependent}</strong><small>Assets requiring cooling context</small></article>
              <article><span><Gauge size={17} /> Site Heat Index</span><strong>{temperature(intelligence?.conditions?.heatIndexC)}</strong><small>{intelligence?.conditionSourceLabel ?? 'Atmospheric context only'}</small></article>
            </section>

            <section className="enterprise-assets-main-grid">
              <EnterpriseAssetMap
                site={selectedSite}
                exposures={exposures}
                thermal={thermal}
                selectedAssetId={selectedAssetId}
                placementMode={assetFormOpen}
                pendingCoordinate={placementConfirmed ? draft?.coordinate ?? null : null}
                onSelectAsset={setSelectedAssetId}
                onPickCoordinate={pickCoordinate}
              />

              <aside className="enterprise-asset-detail panel">
                {selectedExposure ? (
                  <>
                    <div className="enterprise-asset-detail__head">
                      <div><span>SELECTED ASSET</span><h2>{selectedExposure.asset.name}</h2><p>{selectedExposure.asset.assetCode} · {assetTypeLabel(selectedExposure.asset.type)}</p></div>
                      <span className={`asset-risk-pill asset-risk-pill--${selectedExposure.riskBand}`}>{selectedExposure.riskBand.replace('_', ' ')}</span>
                    </div>
                    <div className="enterprise-asset-detail__metrics">
                      <div><span>Latest surface cell</span><strong>{temperature(selectedExposure.latestTemperatureC)}</strong><small>{thermal?.dataStatus === 'verified' ? formatObserved(thermal.observedAt) : 'FortyGuard unavailable'}</small></div>
                      <div><span>Exceedance</span><strong>{hours(selectedExposure.exceedanceHours)}</strong><small>Above {appliedThresholdC.toFixed(1)}°C on {appliedDate}</small></div>
                      <div><span>Persistence</span><strong>{hours(selectedExposure.persistenceHours)}</strong><small>Longest continuous returned run</small></div>
                      <div><span>HeatShield score</span><strong>{selectedExposure.riskScore == null ? '—' : `${selectedExposure.riskScore}/100`}</strong><small>{selectedExposure.evidenceState.replaceAll('_', ' ')} evidence</small></div>
                    </div>
                    <section className="enterprise-asset-detail__section"><span>WHY THIS PRIORITY</span><p>{selectedExposure.rationale}</p></section>
                    <section className="enterprise-asset-detail__section enterprise-asset-detail__section--action"><span>RECOMMENDED REVIEW</span><p>{recommendedAction(selectedExposure)}</p></section>
                    <div className="enterprise-asset-detail__facts">
                      <span><b>Criticality</b>{selectedExposure.asset.criticality}</span>
                      <span><b>Status</b>{selectedExposure.asset.status}</span>
                      <span><b>Configured limit</b>{selectedExposure.asset.heatLimitC == null ? 'Not set' : `${selectedExposure.asset.heatLimitC.toFixed(1)}°C`}</span>
                      <span><b>Peak time</b>{selectedExposure.peakHourLocal ?? 'Unavailable'}</span>
                      <span><b>Cooling dependent</b>{selectedExposure.asset.coolingDependent ? 'Yes' : 'No'}</span>
                      <span><b>Owner</b>{selectedExposure.asset.owner ?? 'Not assigned'}</span>
                    </div>
                    <button type="button" className="enterprise-asset-delete" onClick={deleteSelectedAsset}><Trash2 size={15} /> Remove asset</button>
                  </>
                ) : (
                  <div className="enterprise-asset-detail__empty"><Box size={26} /><strong>{assets.length ? 'Select an asset' : 'No assets registered'}</strong><span>{assets.length ? 'Choose a marker or table row to inspect its evidence.' : 'Add real infrastructure and place it inside the property boundary.'}</span>{!assets.length && <button className="button button--primary" type="button" onClick={openAssetForm}><Plus size={16} /> Add first asset</button>}</div>
                )}
              </aside>
            </section>

            <section className="enterprise-assets-lower-grid">
              <article className="enterprise-assets-table panel">
                <div className="enterprise-assets-section-head"><div><span>ASSET INVENTORY</span><h2>Exposure by Asset</h2></div><div className="enterprise-assets-table__filters"><label><Search size={14} /><input placeholder="Search asset, code or owner" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as typeof riskFilter)}><option value="all">All risk bands</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unassessed">Unassessed</option></select></div></div>
                {filteredExposures.length ? (
                  <div className="enterprise-assets-table__scroll"><table><thead><tr><th>Asset</th><th>Criticality</th><th>Latest surface</th><th>Exceedance</th><th>Persistence</th><th>HeatShield risk</th><th /></tr></thead><tbody>{filteredExposures.map((item) => {
                    const Icon = assetIcon(item.asset.type)
                    return <tr key={item.asset.id} className={item.asset.id === selectedAssetId ? 'selected' : ''} onClick={() => setSelectedAssetId(item.asset.id)}><td><div className="asset-table-name"><span><Icon size={15} /></span><div><strong>{item.asset.name}</strong><small>{item.asset.assetCode} · {assetTypeLabel(item.asset.type)}</small></div></div></td><td><span className={`asset-criticality asset-criticality--${item.asset.criticality}`}>{item.asset.criticality}</span></td><td>{temperature(item.latestTemperatureC)}</td><td>{hours(item.exceedanceHours)}</td><td>{hours(item.persistenceHours)}</td><td><span className={`asset-risk-pill asset-risk-pill--${item.riskBand}`}>{item.riskScore == null ? 'unassessed' : `${item.riskScore}/100 ${item.riskBand}`}</span></td><td><ArrowRight size={15} /></td></tr>
                  })}</tbody></table></div>
                ) : <div className="enterprise-assets-table__empty">No assets match the current filters.</div>}
              </article>

              <aside className="enterprise-assets-priority panel">
                <div className="enterprise-assets-section-head"><div><span>PRIORITY QUEUE</span><h2>Engineering Review</h2></div></div>
                {topPriority.length ? topPriority.map((item, index) => (
                  <button key={item.asset.id} type="button" onClick={() => setSelectedAssetId(item.asset.id)}><span className="enterprise-assets-priority__rank">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.asset.name}</strong><small>{item.riskScore == null ? 'Evidence not matched' : `${item.riskScore}/100 · ${item.riskBand} · ${temperature(item.latestTemperatureC)}`}</small></div><ArrowRight size={15} /></button>
                )) : <div className="enterprise-assets-priority__empty">Register assets to build a site-specific engineering priority queue.</div>}

                <div className="enterprise-assets-provenance">
                  <span>EVIDENCE PROVENANCE</span>
                  <div><CheckCircle2 size={14} /><p><b>Latest TCM:</b> {thermal?.dataStatus === 'verified' ? `${thermal.tileCount} FortyGuard cells · ${formatObserved(thermal.observedAt)}` : 'Unavailable'}</p></div>
                  <div><CheckCircle2 size={14} /><p><b>Daily exposure:</b> {history && ['verified', 'partial'].includes(history.dataStatus) ? `${history.cellCount} cells · ${appliedDate} · ${appliedThresholdC.toFixed(1)}°C · ${appliedGranularity} m` : 'Unavailable'}</p></div>
                  <div><Database size={14} /><p><b>Asset registry:</b> HeatShield enterprise records with exact site coordinates and business criticality.</p></div>
                </div>
              </aside>
            </section>
          </>
        )}
      </main>

      {assetFormOpen && selectedSite && draft && (
        <div className="enterprise-asset-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAssetForm() }}>
          <aside className="enterprise-asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-drawer-title">
            <div className="enterprise-asset-drawer__head"><div><span>REGISTER INFRASTRUCTURE</span><h2 id="asset-drawer-title">Add Enterprise Asset</h2><p>Click the site map to place the asset precisely, then add business and operating context.</p></div><button type="button" onClick={closeAssetForm} aria-label="Close asset form"><X size={18} /></button></div>
            <form onSubmit={submitAsset}>
              <label><span>Asset name *</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Transformer T-04" required /></label>
              <div className="enterprise-asset-drawer__row"><label><span>Asset code</span><input value={draft.assetCode} onChange={(event) => setDraft({ ...draft, assetCode: event.target.value })} placeholder="TR-04" /></label><label><span>Asset type</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as EnterpriseAssetType })}><option value="transformer">Transformer</option><option value="hvac">HVAC</option><option value="chiller">Chiller</option><option value="generator">Generator</option><option value="cooling_tower">Cooling Tower</option><option value="ups">UPS</option><option value="server_room">Server Room</option><option value="loading_area">Loading Area</option><option value="other">Other</option></select></label></div>
              <div className="enterprise-asset-drawer__row"><label><span>Business criticality</span><select value={draft.criticality} onChange={(event) => setDraft({ ...draft, criticality: event.target.value as EnterpriseAsset['criticality'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EnterpriseAsset['status'] })}><option value="operational">Operational</option><option value="maintenance">Maintenance</option><option value="offline">Offline</option></select></label></div>
              <div className="enterprise-asset-drawer__row"><label><span>Thermal operating limit °C</span><input type="number" min="-30" max="100" step="0.5" value={draft.heatLimitC} onChange={(event) => setDraft({ ...draft, heatLimitC: event.target.value })} placeholder="Optional" /></label><label><span>Owner / team</span><input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Facilities / Electrical" /></label></div>
              <label className="enterprise-asset-drawer__check"><input type="checkbox" checked={draft.coolingDependent} onChange={(event) => setDraft({ ...draft, coolingDependent: event.target.checked })} /><span><b>Cooling-dependent asset</b><small>Use this as enterprise context in HeatShield prioritization.</small></span></label>
              <div className="enterprise-asset-drawer__position"><span>MAP POSITION</span><strong>{placementConfirmed ? `${draft.coordinate.lat.toFixed(6)}, ${draft.coordinate.lng.toFixed(6)}` : 'Select a point on the map'}</strong><small><MapPin size={13} /> {placementConfirmed ? 'Location confirmed inside the saved property boundary. Click the map again to move it.' : 'A precise map click is required. HeatShield will not assume the site center is the asset location.'}</small></div>
              <label><span>Notes</span><textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Operating constraints, cooling dependency, maintenance context…" /></label>
              {assetError && <div className="enterprise-asset-drawer__error" role="alert"><AlertTriangle size={15} /> {assetError}</div>}
              <div className="enterprise-asset-drawer__actions"><button type="button" className="button button--secondary" onClick={closeAssetForm}>Cancel</button><button type="submit" className="button button--primary" disabled={assetSaving || !placementConfirmed}>{assetSaving ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}{assetSaving ? 'Saving…' : placementConfirmed ? 'Add Asset' : 'Place Asset First'}</button></div>
            </form>
          </aside>
        </div>
      )}
    </AppShell>
  )
}
