import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  Database,
  Flame,
  Gauge,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  ThermometerSun,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EnterprisePortfolioMap } from '../components/enterprise/EnterprisePortfolioMap'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { EnterpriseAsset } from '../types/asset'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../types/history'
import type { PortfolioRiskBand, PortfolioSiteAssessment } from '../types/portfolio'
import type { Coordinate, Site, SiteIntelligence, ThermalMapResponse, ThermalTile } from '../types/site'
import '../enterprise-portfolio-risk.css'

const STORAGE_KEY = 'heatshield:selected-site'
type Granularity = 60 | 80 | 100

type AssetBand = 'low' | 'medium' | 'high' | 'critical' | 'unassessed'

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

function assetBand(
  asset: EnterpriseAsset,
  thermal: ThermalMapResponse | null,
  history: HistoricalHeatBehaviorResponse | null,
  thresholdC: number,
): AssetBand {
  const tile = thermal?.dataStatus === 'verified' ? findThermalTile(asset.coordinate, thermal.tiles) : null
  const cell = history && ['verified', 'partial'].includes(history.dataStatus) ? findHistoricalCell(asset.coordinate, history.cells) : null
  const latest = tile?.temperatureC ?? null
  const exceedance = cell?.exceedanceHours ?? null
  const persistence = cell?.persistenceHours ?? null
  const hasEvidence = latest != null || exceedance != null || persistence != null || cell?.peakHourLocal != null
  if (!hasEvidence) return 'unassessed'

  const criticalityWeight = { low: 8, medium: 16, high: 26, critical: 36 }[asset.criticality]
  const temperatureContribution = latest == null ? 0 : Math.max(0, Math.min(30, (latest - Math.min(thresholdC, 30)) * 2.2))
  const exceedanceContribution = Math.min(14, Math.max(0, exceedance ?? 0) * 1.6)
  const persistenceContribution = Math.min(14, Math.max(0, persistence ?? 0) * 2.2)
  const heatLimitExceeded = asset.heatLimitC != null && latest != null && latest >= asset.heatLimitC
  const limitContribution = heatLimitExceeded ? 12 : 0
  const coolingContribution = asset.coolingDependent && latest != null && latest >= thresholdC ? 5 : 0
  const score = Math.min(100, criticalityWeight + temperatureContribution + exceedanceContribution + persistenceContribution + limitContribution + coolingContribution)
  return score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'low'
}

function criticalityScore(assets: EnterpriseAsset[]) {
  if (!assets.length) return 0
  const weights = { low: 25, medium: 50, high: 75, critical: 100 }
  return Math.round(assets.reduce((sum, asset) => sum + weights[asset.criticality], 0) / assets.length)
}

function deriveSiteAssessment(
  site: Site,
  assets: EnterpriseAsset[],
  intelligence: SiteIntelligence | null,
  thermal: ThermalMapResponse | null,
  history: HistoricalHeatBehaviorResponse | null,
  thresholdC: number,
  errors: string[],
): PortfolioSiteAssessment {
  const thermalVerified = thermal?.dataStatus === 'verified'
  const historyVerified = Boolean(history && ['verified', 'partial'].includes(history.dataStatus))
  const evidenceState = thermalVerified && historyVerified ? 'verified' : thermalVerified || historyVerified ? 'partial' : 'unavailable'

  const bands = assets.map((asset) => assetBand(asset, thermal, history, thresholdC))
  const assessed = bands.filter((band) => band !== 'unassessed').length
  const highRisk = bands.filter((band) => band === 'high').length
  const criticalRisk = bands.filter((band) => band === 'critical').length
  const limitBreaches = assets.filter((asset) => {
    if (asset.heatLimitC == null || thermal?.dataStatus !== 'verified') return false
    const tile = findThermalTile(asset.coordinate, thermal.tiles)
    return tile != null && tile.temperatureC >= asset.heatLimitC
  }).length
  const businessCritical = assets.filter((asset) => asset.criticality === 'high' || asset.criticality === 'critical').length
  const businessScore = criticalityScore(assets)

  let riskScore: number | null = null
  if (thermalVerified || historyVerified) {
    const peak = thermal?.maxTemperatureC ?? null
    const thermalContribution = peak == null ? 0 : Math.max(0, Math.min(30, (peak - thresholdC + 5) * 3))
    const persistenceContribution = Math.min(22, Math.max(0, history?.maxPersistenceHours ?? 0) * 3)
    const exceedanceContribution = Math.min(18, Math.max(0, history?.meanExceedanceHours ?? 0) * 2)
    const assetContribution = Math.min(20, highRisk * 3 + criticalRisk * 6 + limitBreaches * 4)
    const criticalityContribution = assets.length ? Math.min(10, businessScore * 0.1) : 0
    riskScore = Math.round(Math.min(100, thermalContribution + persistenceContribution + exceedanceContribution + assetContribution + criticalityContribution))
  }

  const riskBand: PortfolioRiskBand = riskScore == null
    ? 'unassessed'
    : riskScore >= 75 ? 'critical' : riskScore >= 55 ? 'high' : riskScore >= 35 ? 'medium' : 'low'

  const warnings = [...errors]
  if (!thermalVerified) warnings.push('Latest verified FortyGuard TCM surface layer is unavailable.')
  if (!historyVerified) warnings.push('Selected-day exceedance/persistence evidence is unavailable.')
  if (!assets.length) warnings.push('No enterprise assets are registered; score reflects site heat evidence only.')
  else if (assessed < assets.length) warnings.push(`${assets.length - assessed} asset(s) are outside currently matched provider cells.`)
  if (intelligence?.fallbackActive) warnings.push('Atmospheric context uses fallback data and is not part of the spatial portfolio score.')

  const rationaleParts = [
    thermal?.maxTemperatureC == null ? null : `${thermal.maxTemperatureC.toFixed(1)}°C peak surface`,
    history?.maxPersistenceHours == null ? null : `${history.maxPersistenceHours.toFixed(1)} h max persistence`,
    history?.meanExceedanceHours == null ? null : `${history.meanExceedanceHours.toFixed(1)} h mean exceedance`,
    assets.length ? `${businessCritical} high/critical business assets` : null,
    criticalRisk ? `${criticalRisk} critical-risk asset${criticalRisk === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return {
    site,
    evidenceState,
    riskBand,
    riskScore,
    peakTemperatureC: thermal?.maxTemperatureC ?? null,
    meanTemperatureC: thermal?.meanTemperatureC ?? null,
    maxPersistenceHours: history?.maxPersistenceHours ?? null,
    meanExceedanceHours: history?.meanExceedanceHours ?? null,
    commonPeakPeriodLocal: history?.commonPeakPeriodLocal ?? history?.commonPeakHourLocal ?? null,
    latestObservedAt: thermal?.observedAt ?? null,
    providerRequestCount: history?.providerRequestCount ?? 0,
    assetSummary: {
      total: assets.length,
      businessCritical,
      assessed,
      highRisk,
      criticalRisk,
      thermalLimitBreaches: limitBreaches,
      coolingDependent: assets.filter((asset) => asset.coolingDependent).length,
    },
    businessCriticalityScore: businessScore,
    rationale: rationaleParts.length ? rationaleParts.join(' · ') : 'Verified spatial evidence has not been returned for this site.',
    warnings,
    completedAt: new Date().toISOString(),
  }
}

function riskLabel(band: PortfolioRiskBand) {
  return band === 'unassessed' ? 'Unassessed' : `${band.charAt(0).toUpperCase()}${band.slice(1)}`
}

function temperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function hours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function priorityAction(assessment: PortfolioSiteAssessment) {
  if (assessment.riskBand === 'unassessed') return 'Restore verified spatial evidence before making portfolio allocation decisions.'
  if (assessment.assetSummary.thermalLimitBreaches) return 'Review assets with configured thermal-limit breaches and validate operating margin before the next peak period.'
  if (assessment.riskBand === 'critical') return 'Escalate this site for engineering review and compare permanent mitigation options against the highest-exposure cells.'
  if (assessment.riskBand === 'high') return 'Prioritize hotspot and critical-asset review, then identify targeted mitigation candidates.'
  if (assessment.riskBand === 'medium') return 'Keep this site in the active review queue and reassess on hotter completed days.'
  return 'Maintain monitoring; no portfolio escalation is indicated by the current selected-day evidence.'
}

export function EnterprisePortfolioRiskPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [assessments, setAssessments] = useState<Record<string, PortfolioSiteAssessment>>({})
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [analysisDate, setAnalysisDate] = useState(defaultAnalysisDate)
  const [thresholdC, setThresholdC] = useState(35)
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [loadingSites, setLoadingSites] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [riskFilter, setRiskFilter] = useState<'all' | PortfolioRiskBand>('all')
  const [lastRunSignature, setLastRunSignature] = useState<string | null>(null)

  useEffect(() => {
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

  const controlSignature = `${analysisDate}|${thresholdC}|${granularity}`
  const controlsChanged = lastRunSignature != null && lastRunSignature !== controlSignature

  const assessSite = useCallback(async (site: Site) => {
    const results = await Promise.allSettled([
      api.listEnterpriseAssets(site.id),
      api.getSiteIntelligence(site.id),
      api.generateThermalMap(site.id, { mode: 'site', granularityMeters: granularity }),
      api.generateHistoricalHeatBehavior(site.id, {
        startDate: analysisDate,
        endDate: analysisDate,
        thresholdF: celsiusToFahrenheit(thresholdC),
        granularityMeters: granularity,
      }),
    ])

    const errors: string[] = []
    const assets = results[0].status === 'fulfilled' ? results[0].value : []
    const intelligence = results[1].status === 'fulfilled' ? results[1].value : null
    const thermal = results[2].status === 'fulfilled' ? results[2].value : null
    const history = results[3].status === 'fulfilled' ? results[3].value : null

    results.forEach((result, index) => {
      if (result.status !== 'rejected') return
      const labels = ['asset registry', 'site context', 'latest thermal layer', 'historical exposure']
      errors.push(`${labels[index]}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`)
    })

    return deriveSiteAssessment(site, assets, intelligence, thermal, history, thresholdC, errors)
  }, [analysisDate, granularity, thresholdC])

  const runPortfolio = async () => {
    if (!sites.length || running) return
    setRunning(true)
    setError(null)
    setProgress({ done: 0, total: sites.length })
    const next: Record<string, PortfolioSiteAssessment> = {}
    try {
      for (let index = 0; index < sites.length; index += 1) {
        const site = sites[index]
        try {
          const assessment = await assessSite(site)
          next[site.id] = assessment
          setAssessments((current) => ({ ...current, [site.id]: assessment }))
        } catch (err) {
          next[site.id] = {
            site,
            evidenceState: 'unavailable',
            riskBand: 'unassessed',
            riskScore: null,
            providerRequestCount: 0,
            assetSummary: { total: 0, businessCritical: 0, assessed: 0, highRisk: 0, criticalRisk: 0, thermalLimitBreaches: 0, coolingDependent: 0 },
            businessCriticalityScore: 0,
            rationale: 'Portfolio assessment failed for this site.',
            warnings: [err instanceof Error ? err.message : 'Unknown site assessment error.'],
            completedAt: new Date().toISOString(),
          }
          setAssessments((current) => ({ ...current, [site.id]: next[site.id] }))
        }
        setProgress({ done: index + 1, total: sites.length })
      }
      setLastRunSignature(controlSignature)
    } finally {
      setRunning(false)
    }
  }

  const assessmentList = useMemo(() => sites.map((site) => assessments[site.id] ?? {
    site,
    evidenceState: 'pending' as const,
    riskBand: 'unassessed' as const,
    riskScore: null,
    providerRequestCount: 0,
    assetSummary: { total: 0, businessCritical: 0, assessed: 0, highRisk: 0, criticalRisk: 0, thermalLimitBreaches: 0, coolingDependent: 0 },
    businessCriticalityScore: 0,
    rationale: 'Portfolio assessment has not been run for this site.',
    warnings: [],
    completedAt: null,
  }), [assessments, sites])

  const ranked = useMemo(() => [...assessmentList].sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1)), [assessmentList])
  const assessedSites = ranked.filter((item) => item.riskScore != null)
  const portfolioScore = assessedSites.length ? Math.round(assessedSites.reduce((sum, item) => sum + (item.riskScore ?? 0), 0) / assessedSites.length) : null
  const highPrioritySites = assessedSites.filter((item) => item.riskBand === 'high' || item.riskBand === 'critical').length
  const totalHighRiskAssets = assessedSites.reduce((sum, item) => sum + item.assetSummary.highRisk + item.assetSummary.criticalRisk, 0)
  const totalCriticalAssets = assessmentList.reduce((sum, item) => sum + item.assetSummary.businessCritical, 0)
  const providerVerifiedSites = assessmentList.filter((item) => item.evidenceState === 'verified').length
  const evidenceCoverage = sites.length ? Math.round(providerVerifiedSites / sites.length * 100) : 0
  const prioritySite = ranked.find((item) => item.riskScore != null) ?? null
  const providerRequests = assessmentList.reduce((sum, item) => sum + item.providerRequestCount, 0)

  const selectedAssessment = assessmentList.find((item) => item.site.id === selectedSiteId) ?? prioritySite ?? assessmentList[0] ?? null

  const filteredRanked = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return ranked.filter((item) => {
      const matchesQuery = !needle || `${item.site.name} ${item.site.address}`.toLowerCase().includes(needle)
      const matchesRisk = riskFilter === 'all' || item.riskBand === riskFilter
      return matchesQuery && matchesRisk
    })
  }, [query, ranked, riskFilter])

  const selectSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId)
    localStorage.setItem(STORAGE_KEY, siteId)
  }, [])

  const maxDate = localDateString(new Date())

  return (
    <AppShell module="enterprise">
      <header className="portfolio-topbar">
        <div><h1>Portfolio Risk</h1><span>Rank enterprise sites by verified heat exposure, infrastructure context and evidence quality.</span></div>
        <div className="portfolio-topbar__spacer" />
        <div className="portfolio-core"><span /><div><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard evidence core</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="portfolio-page">
        {loadingSites && <StatePanel kind="loading" title="Loading enterprise portfolio" detail="Reading saved sites and portfolio context…" />}
        {!loadingSites && !sites.length && (
          <StatePanel kind="empty" title="No enterprise sites available" detail="Add properties in Enterprise Sites before running portfolio risk analysis." />
        )}

        {!loadingSites && sites.length > 0 && (
          <>
            <section className="portfolio-hero">
              <div><span className="portfolio-eyebrow">PORTFOLIO DECISION LAYER</span><h2>Heat Risk Across the Enterprise</h2><p>Compare sites using the same evidence rules. Scores are HeatShield-derived and never presented as FortyGuard provider scores.</p></div>
              <div className="portfolio-controls panel">
                <label><span>Completed day</span><div><CalendarDays size={15} /><input type="date" min="2021-01-01" max={maxDate} value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} /></div></label>
                <label><span>Heat threshold</span><div><ThermometerSun size={15} /><input type="number" min="20" max="55" step="0.5" value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))} /><b>°C</b></div></label>
                <label><span>Resolution</span><div><Database size={15} /><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as Granularity)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></div></label>
                <button className="button button--primary" type="button" onClick={() => void runPortfolio()} disabled={running}>{running ? <RefreshCw size={16} className="spin" /> : <Layers size={16} />}{running ? `Assessing ${progress.done}/${progress.total}` : 'Run Portfolio Assessment'}</button>
              </div>
            </section>

            <div className="portfolio-evidence-note"><ShieldCheck size={15} /><span><strong>Evidence policy:</strong> latest TCM surface temperature, selected-day exceedance/persistence and registered asset context are kept separate. Portfolio score is a transparent HeatShield interpretation.</span></div>
            {controlsChanged && <div className="portfolio-warning"><AlertTriangle size={15} /> Analysis controls changed after the last run. Re-run the portfolio before using the ranking for decisions.</div>}
            {error && <div className="portfolio-warning"><AlertTriangle size={15} /> {error}</div>}

            <section className="portfolio-kpis">
              <article><span><Gauge size={17} /> Portfolio Heat Score</span><strong>{portfolioScore ?? '—'}</strong><small>{portfolioScore == null ? 'Run assessment to calculate' : 'HeatShield-derived · 0–100'}</small></article>
              <article className={highPrioritySites ? 'alert' : ''}><span><Flame size={17} /> High-Priority Sites</span><strong>{highPrioritySites}</strong><small>High + critical scored sites</small></article>
              <article><span><Zap size={17} /> High-Risk Assets</span><strong>{totalHighRiskAssets}</strong><small>{totalCriticalAssets} high/critical business assets registered</small></article>
              <article><span><ShieldCheck size={17} /> Verified Site Coverage</span><strong>{evidenceCoverage}%</strong><small>{providerVerifiedSites}/{sites.length} sites with both thermal + daily evidence</small></article>
              <article><span><Target size={17} /> Priority Site</span><strong>{prioritySite?.site.name ?? '—'}</strong><small>{prioritySite?.riskScore == null ? 'No scored site yet' : `${prioritySite.riskScore}/100 · ${riskLabel(prioritySite.riskBand)}`}</small></article>
              <article><span><Database size={17} /> Provider Requests</span><strong>{providerRequests}</strong><small>Selected-day historical layer requests returned</small></article>
            </section>

            <section className="portfolio-grid">
              <div className="portfolio-ranking panel">
                <div className="portfolio-section-head"><div><span>SITE PRIORITIZATION</span><h2>Portfolio Risk Ranking</h2><p>Ranked only after evidence is returned. Unassessed sites stay visible instead of receiving fabricated scores.</p></div></div>
                <div className="portfolio-ranking__toolbar">
                  <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search site or address…" /></label>
                  <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as 'all' | PortfolioRiskBand)}><option value="all">All risk bands</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="unassessed">Unassessed</option></select>
                </div>
                <div className="portfolio-table-wrap">
                  <table className="portfolio-table">
                    <thead><tr><th>Rank</th><th>Site</th><th>Score</th><th>Peak Surface</th><th>Persistence</th><th>Critical Assets</th><th>Evidence</th><th /></tr></thead>
                    <tbody>{filteredRanked.map((item, index) => <tr key={item.site.id} className={item.site.id === selectedSiteId ? 'selected' : ''} onClick={() => selectSite(item.site.id)}><td>{item.riskScore == null ? '—' : String(index + 1).padStart(2, '0')}</td><td><strong>{item.site.name}</strong><small>{item.site.address}</small></td><td><span className={`risk-pill ${item.riskBand}`}>{item.riskScore == null ? 'Unassessed' : `${item.riskScore} · ${riskLabel(item.riskBand)}`}</span></td><td>{temperature(item.peakTemperatureC)}</td><td>{hours(item.maxPersistenceHours)}</td><td>{item.assetSummary.businessCritical}</td><td><span className={`evidence-pill ${item.evidenceState}`}>{item.evidenceState}</span></td><td><ArrowRight size={15} /></td></tr>)}</tbody>
                  </table>
                </div>
              </div>

              <div className="portfolio-insights panel">
                <div className="portfolio-section-head"><div><span>PORTFOLIO INSIGHTS</span><h2>{selectedAssessment?.site.name ?? 'Select a site'}</h2><p>{selectedAssessment?.rationale ?? 'Run assessment to populate decision context.'}</p></div></div>
                {selectedAssessment && <>
                  <div className="portfolio-insight-score"><div><span>HeatShield site score</span><strong>{selectedAssessment.riskScore ?? '—'}</strong></div><span className={`risk-pill ${selectedAssessment.riskBand}`}>{riskLabel(selectedAssessment.riskBand)}</span></div>
                  <div className="portfolio-insight-grid"><div><span>Peak surface</span><strong>{temperature(selectedAssessment.peakTemperatureC)}</strong></div><div><span>Mean exceedance</span><strong>{hours(selectedAssessment.meanExceedanceHours)}</strong></div><div><span>Peak period</span><strong>{selectedAssessment.commonPeakPeriodLocal ?? '—'}</strong></div><div><span>Asset coverage</span><strong>{selectedAssessment.assetSummary.total ? `${selectedAssessment.assetSummary.assessed}/${selectedAssessment.assetSummary.total}` : 'No assets'}</strong></div></div>
                  <div className="portfolio-action"><span>NEXT REVIEW</span><p>{priorityAction(selectedAssessment)}</p></div>
                  {selectedAssessment.warnings.length > 0 && <div className="portfolio-quality"><span>Evidence notes</span>{selectedAssessment.warnings.slice(0, 4).map((warning) => <p key={warning}><AlertTriangle size={13} /> {warning}</p>)}</div>}
                  <div className="portfolio-links"><Link to={`/enterprise/property-exposure?site=${selectedAssessment.site.id}`}>Property Exposure <ArrowRight size={14} /></Link><Link to={`/enterprise/assets?site=${selectedAssessment.site.id}`}>Asset Intelligence <ArrowRight size={14} /></Link></div>
                </>}
              </div>
            </section>

            <section className="portfolio-analysis-grid">
              <EnterprisePortfolioMap assessments={assessmentList} selectedSiteId={selectedSiteId} onSelectSite={selectSite} />

              <section className="portfolio-matrix panel">
                <div className="portfolio-section-head"><div><span>DECISION MATRIX</span><h2>Heat Risk × Business Criticality</h2><p>Higher-right sites combine stronger heat evidence with more critical registered infrastructure.</p></div></div>
                <div className="portfolio-matrix__plot">
                  <div className="portfolio-matrix__quadrant q1">Monitor</div><div className="portfolio-matrix__quadrant q2">Protect assets</div><div className="portfolio-matrix__quadrant q3">Heat mitigation</div><div className="portfolio-matrix__quadrant q4">Priority intervention</div>
                  {assessedSites.map((item) => <button key={item.site.id} type="button" className={`portfolio-matrix__dot ${item.riskBand}${item.site.id === selectedSiteId ? ' selected' : ''}`} style={{ left: `${Math.max(4, Math.min(96, item.businessCriticalityScore || 8))}%`, bottom: `${Math.max(4, Math.min(96, item.riskScore ?? 4))}%` }} title={`${item.site.name}: ${item.riskScore}/100`} onClick={() => selectSite(item.site.id)}><span>{item.site.name.slice(0, 2).toUpperCase()}</span></button>)}
                  <span className="portfolio-matrix__x">Business criticality →</span><span className="portfolio-matrix__y">Heat risk →</span>
                </div>
              </section>
            </section>

            <section className="portfolio-bottom-grid">
              <div className="portfolio-priority panel">
                <div className="portfolio-section-head"><div><span>CAPITAL / ENGINEERING QUEUE</span><h2>Intervention Prioritization</h2><p>No fake ROI or budget estimates are shown. This queue prioritizes review effort from evidence and asset criticality only.</p></div></div>
                <div className="portfolio-priority-list">{ranked.slice(0, 5).map((item, index) => <article key={item.site.id}><div className="portfolio-priority-rank">{String(index + 1).padStart(2, '0')}</div><div><strong>{item.site.name}</strong><span>{item.rationale}</span><small>{priorityAction(item)}</small></div><span className={`risk-pill ${item.riskBand}`}>{item.riskScore == null ? 'Unassessed' : `${item.riskScore}/100`}</span></article>)}</div>
              </div>

              <div className="portfolio-governance panel">
                <div className="portfolio-section-head"><div><span>PORTFOLIO GOVERNANCE</span><h2>Decision Readiness</h2><p>Before portfolio actions, check whether the evidence is complete enough for comparison.</p></div></div>
                <div className="portfolio-readiness"><article><CheckCircle2 size={17} /><div><strong>{sites.length} properties registered</strong><span>All portfolio sites remain visible regardless of evidence state.</span></div></article><article><ShieldCheck size={17} /><div><strong>{providerVerifiedSites} fully verified sites</strong><span>Both latest thermal and selected-day historical evidence available.</span></div></article><article><Building2 size={17} /><div><strong>{assessmentList.reduce((sum, item) => sum + item.assetSummary.total, 0)} registered assets</strong><span>Business context comes from the HeatShield Enterprise asset registry.</span></div></article><article><BarChart3 size={17} /><div><strong>Score provenance visible</strong><span>HeatShield score is derived; FortyGuard measurements stay separately identified.</span></div></article></div>
              </div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
