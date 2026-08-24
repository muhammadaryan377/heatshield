import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Flame,
  Gauge,
  Layers3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  ThermometerSun,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EnterpriseThermalOverview } from '../components/enterprise/EnterpriseThermalOverview'
import { AppShell } from '../components/layout/AppShell'
import { CreateSiteModal } from '../components/site/CreateSiteModal'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { RiskLevel, Site, SiteIntelligence, ThermalMapResponse } from '../types/site'
import '../enterprise-overview.css'

const STORAGE_KEY = 'heatshield:selected-site'

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function formatTemperature(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}°C`
}

function formatObservedAt(value?: string | null) {
  if (!value) return 'No verified timestamp'
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

function riskLabel(risk?: RiskLevel | null) {
  if (!risk) return 'Awaiting evidence'
  if (risk === 'extreme') return 'Critical review'
  if (risk === 'high') return 'High priority'
  if (risk === 'medium') return 'Elevated watch'
  return 'Routine monitor'
}

function riskTone(risk?: RiskLevel | null) {
  if (risk === 'extreme' || risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  if (risk === 'low') return 'safe'
  return 'neutral'
}

function riskName(risk?: RiskLevel | null) {
  if (!risk) return 'Pending'
  return risk.charAt(0).toUpperCase() + risk.slice(1)
}

function forecastLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('en-US', { hour: 'numeric' })
}

export function EnterpriseOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [data, setData] = useState<SiteIntelligence | null>(null)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [sitesLoading, setSitesLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [thermalLoading, setThermalLoading] = useState(false)
  const [intelError, setIntelError] = useState<string | null>(null)
  const [thermalError, setThermalError] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [createSiteOpen, setCreateSiteOpen] = useState(false)

  const reload = useCallback(() => setRequestKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setSitesLoading(true)
    api.listSites(controller.signal)
      .then((loadedSites) => {
        if (!active || controller.signal.aborted) return
        setSites(loadedSites)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, stored].find((id) => id && loadedSites.some((site) => site.id === id))
        setSelectedSiteId(preferred ?? loadedSites[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error, controller.signal)) return
        setIntelError(error instanceof Error ? error.message : 'Unable to load enterprise sites.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setSitesLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // Initial selection is resolved once; subsequent changes are handled locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSiteId) {
      setData(null)
      setThermal(null)
      setLoading(false)
      setThermalLoading(false)
      return
    }

    localStorage.setItem(STORAGE_KEY, selectedSiteId)
    setSearchParams({ site: selectedSiteId }, { replace: true })

    const controller = new AbortController()
    let active = true
    setLoading(true)
    setThermalLoading(true)
    setIntelError(null)
    setThermalError(null)

    api.getSiteIntelligence(selectedSiteId, controller.signal)
      .then((response) => {
        if (!active || controller.signal.aborted) return
        setData(response)
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error, controller.signal)) return
        setIntelError(error instanceof Error ? error.message : 'Unable to load site intelligence.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false)
      })

    api.generateThermalMap(selectedSiteId, {
      mode: 'site',
      granularityMeters: 100,
    }, controller.signal)
      .then((response) => {
        if (!active || controller.signal.aborted) return
        setThermal(response)
        if (response.dataStatus !== 'verified') {
          setThermalError(response.message ?? 'Verified FortyGuard spatial cells are not available for this site.')
        }
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error, controller.signal)) return
        setThermal(null)
        setThermalError(error instanceof Error ? error.message : 'Unable to load the FortyGuard thermal layer.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setThermalLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [requestKey, selectedSiteId, setSearchParams])

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? data?.site ?? null,
    [data?.site, selectedSiteId, sites],
  )

  const hottestTiles = useMemo(() => {
    if (thermal?.dataStatus !== 'verified') return []
    return [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC).slice(0, 4)
  }, [thermal])

  const forecast = useMemo(
    () => (data?.forecast ?? []).slice(0, 12).map((point) => ({
      time: forecastLabel(point.time),
      temperatureC: point.temperatureC,
    })),
    [data?.forecast],
  )

  const risk = data?.risk?.level
  const evidenceVerified = thermal?.dataStatus === 'verified'
  const observedAt = thermal?.observedAt ?? data?.observedAt ?? null
  const thermalRange = evidenceVerified && thermal?.maxTemperatureC != null && thermal.minTemperatureC != null
    ? thermal.maxTemperatureC - thermal.minTemperatureC
    : null
  const hotspotDelta = evidenceVerified && thermal?.maxTemperatureC != null && thermal.meanTemperatureC != null
    ? thermal.maxTemperatureC - thermal.meanTemperatureC
    : null
  const peakWindow = data?.risk?.peakWindowStart && data.risk.peakWindowEnd
    ? `${data.risk.peakWindowStart} – ${data.risk.peakWindowEnd}`
    : 'No peak window returned'
  const conditionSource = data?.conditionSourceLabel ?? (data?.conditionSource === 'fortyguard' ? 'FortyGuard' : data?.conditionSource === 'nws' ? 'NWS fallback' : 'Unavailable')

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId)
    setData(null)
    setThermal(null)
  }

  const siteCreated = (site: Site) => {
    setSites((current) => [site, ...current.filter((item) => item.id !== site.id)])
    setSelectedSiteId(site.id)
    setData(null)
    setThermal(null)
  }

  return (
    <AppShell module="enterprise">
      <header className="enterprise-topbar">
        <div>
          <h1>Enterprise Heat Intelligence</h1>
          <span>Property, infrastructure and portfolio decisions from verified thermal evidence.</span>
        </div>
        <div className="enterprise-topbar__spacer" />
        <div className="enterprise-core-badge">
          <span className="enterprise-core-badge__dot" />
          <span><small>HEATSHIELD INTELLIGENCE</small><strong>FortyGuard evidence core</strong></span>
        </div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="enterprise-overview">
        {sitesLoading && <StatePanel kind="loading" title="Loading Enterprise Intelligence" detail="Reading enterprise sites and evidence configuration…" />}

        {!sitesLoading && !sites.length && !intelError && (
          <section className="enterprise-empty panel">
            <span className="enterprise-empty__icon"><Building2 size={26} /></span>
            <div>
              <span className="enterprise-eyebrow">START WITH VERIFIED SITE GEOMETRY</span>
              <h2>Add your first enterprise property</h2>
              <p>HeatShield needs the real site boundary before FortyGuard spatial evidence can be requested. No synthetic property heat layer is created.</p>
            </div>
            <button type="button" className="button button--primary" onClick={() => setCreateSiteOpen(true)}>Add Enterprise Site</button>
          </section>
        )}

        {!sitesLoading && intelError && !selectedSite && (
          <StatePanel kind="error" title="Enterprise sites unavailable" detail={intelError} onRetry={() => window.location.reload()} />
        )}

        {selectedSite && (
          <>
            <section className="enterprise-site-hero panel">
              <div className="enterprise-site-hero__site">
                <span>SELECTED SITE</span>
                <label className="enterprise-site-selector">
                  <MapPin size={17} />
                  <select value={selectedSite.id} onChange={(event) => selectSite(event.target.value)}>
                    {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                  </select>
                </label>
                <p>{selectedSite.address}</p>
                <small>{selectedSite.center.lat.toFixed(4)}° N, {Math.abs(selectedSite.center.lng).toFixed(4)}° {selectedSite.center.lng < 0 ? 'W' : 'E'} · {selectedSite.polygon.length} boundary points</small>
              </div>

              <div className="enterprise-site-hero__analysis">
                <span>ANALYSIS OBSERVATION</span>
                <strong><CalendarDays size={17} /> {formatObservedAt(observedAt)}</strong>
                <small>{thermal?.timezoneName ? `${thermal.timezoneName} · ` : ''}{thermal?.cached ? 'Cached verified spatial result' : 'Latest available evidence'}</small>
              </div>

              <div className="enterprise-site-hero__status">
                <span>EVIDENCE STATUS</span>
                <strong className={evidenceVerified ? 'verified' : 'pending'}>
                  {evidenceVerified ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
                  {evidenceVerified ? 'Spatial evidence verified' : thermalLoading ? 'Checking FortyGuard' : 'Spatial evidence incomplete'}
                </strong>
                <small>Conditions: {conditionSource}</small>
                <button type="button" onClick={reload} disabled={loading || thermalLoading}><RefreshCw size={14} className={loading || thermalLoading ? 'spin' : ''} /> Refresh evidence</button>
              </div>
            </section>

            {data?.fallbackActive && (
              <div className="enterprise-source-warning">
                <AlertTriangle size={16} />
                <span>Atmospheric conditions are using {conditionSource}. Spatial temperature cells remain FortyGuard-only, so HeatShield does not use fallback weather to fabricate a thermal map.</span>
              </div>
            )}

            {intelError && data && (
              <div className="enterprise-source-warning">
                <AlertTriangle size={16} />
                <span>Latest condition refresh failed. The last successful site response remains visible.</span>
              </div>
            )}

            <section className="enterprise-kpis" aria-label="Enterprise heat metrics">
              <article className="enterprise-kpi">
                <span><ThermometerSun size={17} /> Peak Surface Temp</span>
                <strong>{formatTemperature(thermal?.maxTemperatureC)}</strong>
                <small>{evidenceVerified ? 'Verified FortyGuard maximum' : 'Awaiting spatial cells'}</small>
              </article>
              <article className="enterprise-kpi">
                <span><Gauge size={17} /> Mean Surface Temp</span>
                <strong>{formatTemperature(thermal?.meanTemperatureC)}</strong>
                <small>{evidenceVerified ? `${thermal?.tileCount ?? 0} cells in site analysis` : 'No synthetic mean shown'}</small>
              </article>
              <article className="enterprise-kpi">
                <span><Flame size={17} /> Atmospheric Heat Index</span>
                <strong>{formatTemperature(data?.conditions?.heatIndexC)}</strong>
                <small>{data?.conditions ? `${conditionSource} conditions` : 'Conditions unavailable'}</small>
              </article>
              <article className="enterprise-kpi">
                <span><Layers3 size={17} /> Thermal Range</span>
                <strong>{thermalRange == null ? '—' : `${thermalRange.toFixed(1)}°C`}</strong>
                <small>{thermalRange == null ? 'Needs verified cells' : 'Coolest to hottest site cell'}</small>
              </article>
              <article className="enterprise-kpi">
                <span><Database size={17} /> Verified Spatial Cells</span>
                <strong>{evidenceVerified ? thermal?.tileCount ?? 0 : '—'}</strong>
                <small>{thermal?.granularityMeters ? `${thermal.granularityMeters} m FortyGuard analysis` : 'Provider coverage pending'}</small>
              </article>
              <article className={`enterprise-kpi enterprise-kpi--${riskTone(risk)}`}>
                <span><Activity size={17} /> Decision Priority</span>
                <strong>{riskLabel(risk)}</strong>
                <small>{data?.risk?.summary ?? 'Site-level risk waits for condition evidence'}</small>
              </article>
            </section>

            <section className="enterprise-overview__main-grid">
              <EnterpriseThermalOverview site={selectedSite} thermal={thermal} loading={thermalLoading} onRefresh={reload} />

              <aside className="enterprise-insights panel">
                <div className="enterprise-insights__header">
                  <div><span className="enterprise-eyebrow">DECISION CONTEXT</span><h2>Insights</h2></div>
                  <span className={`enterprise-risk-pill enterprise-risk-pill--${riskTone(risk)}`}>{riskName(risk)}</span>
                </div>

                <section className="enterprise-insight-block">
                  <div className="enterprise-insight-block__title"><strong>Top Hotspots</strong><Link to="/enterprise/property-exposure">Open exposure <ArrowRight size={13} /></Link></div>
                  {hottestTiles.length ? hottestTiles.map((tile, index) => (
                    <div key={tile.id} className="enterprise-hotspot-row">
                      <span className={`enterprise-hotspot-row__rank enterprise-hotspot-row__rank--${index + 1}`}>{index + 1}</span>
                      <span><strong>Hot zone {String(index + 1).padStart(2, '0')}</strong><small>FortyGuard cell {tile.id.replace('tile-', '')}</small></span>
                      <strong>{tile.temperatureC.toFixed(1)}°C</strong>
                    </div>
                  )) : <p className="enterprise-insight-empty">No verified spatial cells to rank yet.</p>}
                </section>

                <section className="enterprise-insight-card">
                  <span className="enterprise-insight-card__icon"><Building2 size={18} /></span>
                  <div>
                    <span>Asset Exposure</span>
                    <strong>Asset registry not connected yet</strong>
                    <p>Attach critical equipment to map heat evidence to operational infrastructure.</p>
                    <Link to="/enterprise/assets">Connect assets <ArrowRight size={13} /></Link>
                  </div>
                </section>

                <section className="enterprise-insight-card">
                  <span className="enterprise-insight-card__icon"><ThermometerSun size={18} /></span>
                  <div>
                    <span>Thermal Pattern</span>
                    <strong>{hotspotDelta == null ? 'Awaiting spatial evidence' : hotspotDelta >= 2.5 ? 'Localized hotspot pattern' : 'Broad site heat load'}</strong>
                    <p>{hotspotDelta == null ? 'A verified spatial layer is required before HeatShield interprets the site pattern.' : hotspotDelta >= 2.5 ? `The hottest cell is ${hotspotDelta.toFixed(1)}°C above the verified site mean. Inspect materials, shade and asset placement before choosing an intervention.` : 'The hottest cell is close to the site mean, so site-wide exposure may matter more than one isolated hotspot.'}</p>
                  </div>
                </section>

                <section className="enterprise-insight-card enterprise-insight-card--evidence">
                  <span className="enterprise-insight-card__icon"><ShieldCheck size={18} /></span>
                  <div>
                    <span>Evidence Provenance</span>
                    <strong>{evidenceVerified ? 'FortyGuard spatial package verified' : 'Spatial package incomplete'}</strong>
                    <p>{evidenceVerified ? `${thermal?.tileCount} provider cells · ${formatObservedAt(thermal?.observedAt)}` : thermalError ?? 'No verified thermal cells returned.'}</p>
                    <small>Atmospheric source: {conditionSource}</small>
                  </div>
                </section>
              </aside>
            </section>

            <section className="enterprise-lower-grid">
              <article className="enterprise-summary-card panel">
                <div className="enterprise-summary-card__title"><span><ShieldCheck size={17} /> Latest Site Analysis</span><Link to="/enterprise/property-exposure">Details <ArrowRight size={13} /></Link></div>
                <dl className="enterprise-analysis-list">
                  <div><dt>Spatial evidence</dt><dd className={evidenceVerified ? 'ok' : 'warn'}>{evidenceVerified ? 'Verified' : 'Unavailable'}</dd></div>
                  <div><dt>Provider cells</dt><dd>{evidenceVerified ? thermal?.tileCount ?? 0 : '—'}</dd></div>
                  <div><dt>Conditions source</dt><dd>{conditionSource}</dd></div>
                  <div><dt>Observed</dt><dd>{formatObservedAt(observedAt)}</dd></div>
                </dl>
              </article>

              <article className="enterprise-summary-card panel">
                <div className="enterprise-summary-card__title"><span><Clock3 size={17} /> Operational Risk Window</span><span className={`enterprise-risk-pill enterprise-risk-pill--${riskTone(risk)}`}>{riskName(risk)}</span></div>
                <strong className="enterprise-window-value">{peakWindow}</strong>
                <p>{data?.risk?.detail ?? 'HeatShield will show the provider-supported risk window when atmospheric evidence is available.'}</p>
                <Link to="/enterprise/industrial">Open industrial analysis <ArrowRight size={13} /></Link>
              </article>

              <article className="enterprise-summary-card panel">
                <div className="enterprise-summary-card__title"><span><FileText size={17} /> Priority Next Steps</span><Link to="/enterprise/reports">Reports <ArrowRight size={13} /></Link></div>
                <ol className="enterprise-next-steps">
                  <li><span>1</span><div><strong>Inspect mapped hotspot zones</strong><small>Use Property Heat Exposure for thresholds, persistence and exceedance.</small></div></li>
                  <li><span>2</span><div><strong>Attach critical assets</strong><small>Connect transformers, HVAC and operational infrastructure to site coordinates.</small></div></li>
                  <li><span>3</span><div><strong>Review decision window</strong><small>Move from evidence to a reviewable operational action, not an automatic intervention.</small></div></li>
                </ol>
              </article>

              <article className="enterprise-summary-card enterprise-summary-card--chart panel">
                <div className="enterprise-summary-card__title"><span><Activity size={17} /> Temperature Outlook</span><small>{forecast.length ? 'Site conditions' : 'No forecast'}</small></div>
                {forecast.length ? (
                  <div className="enterprise-forecast-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={forecast} margin={{ top: 10, right: 8, bottom: 0, left: -22 }}>
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#7b898e' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: '#7b898e' }} axisLine={false} tickLine={false} domain={['dataMin - 2', 'dataMax + 2']} />
                        <Tooltip formatter={(value: number) => [`${value.toFixed(1)}°C`, 'Temperature']} labelStyle={{ color: '#142126' }} />
                        <Line type="monotone" dataKey="temperatureC" stroke="#ef8b27" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="enterprise-chart-empty">No forecast points were returned for this site.</div>
                )}
              </article>
            </section>

            <div className="enterprise-evidence-footer">
              <CheckCircle2 size={17} />
              <span><strong>Evidence-first operation:</strong> provider observations are separated from HeatShield workflow recommendations. Persistence, exceedance, asset exposure and engineering interventions are not invented when their required evidence is missing.</span>
            </div>
          </>
        )}
      </main>

      <CreateSiteModal open={createSiteOpen} onClose={() => setCreateSiteOpen(false)} onCreated={siteCreated} />
    </AppShell>
  )
}
