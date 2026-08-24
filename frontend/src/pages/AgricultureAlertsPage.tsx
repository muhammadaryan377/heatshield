import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Gauge,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  ThermometerSun,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { agricultureApi } from '../lib/agricultureApi'
import { api } from '../lib/api'
import type { AgricultureField, AgricultureFieldHeatProfile } from '../types/agriculture'
import type { Coordinate, Site, SiteIntelligence, Worker } from '../types/site'
import '../agriculture-alerts.css'

const DEFAULT_THRESHOLD_C = 35
const ACK_STORAGE_KEY = 'heatshield:agriculture-alerts:acknowledged'

type AlertSeverity = 'critical' | 'high' | 'watch' | 'info'
type AlertStatus = 'active' | 'acknowledged'

type AgricultureAlert = {
  id: string
  severity: AlertSeverity
  title: string
  summary: string
  evidence: string
  action: string
  source: string
  href: string
  observedAt?: string | null
}

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  if (polygon.length < 3) return false
  let inside = false
  let j = polygon.length - 1
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    const crosses = (current.lat > point.lat) !== (previous.lat > point.lat)
    if (crosses) {
      const denominator = previous.lat - current.lat
      if (Math.abs(denominator) > 1e-12) {
        const crossingLng = ((previous.lng - current.lng) * (point.lat - current.lat)) / denominator + current.lng
        if (point.lng < crossingLng) inside = !inside
      }
    }
    j = i
  }
  return inside
}

function formatTemp(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function formatHours(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)} h`
}

function formatObserved(value?: string | null) {
  if (!value) return 'Observation time unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function severityRank(severity: AlertSeverity) {
  return severity === 'critical' ? 4 : severity === 'high' ? 3 : severity === 'watch' ? 2 : 1
}

function severityLabel(severity: AlertSeverity) {
  if (severity === 'critical') return 'Critical'
  if (severity === 'high') return 'High'
  if (severity === 'watch') return 'Watch'
  return 'Info'
}

function initialAcknowledged(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACK_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function buildAlerts({
  farm,
  field,
  profile,
  intel,
  workers,
}: {
  farm: Site | null
  field: AgricultureField | null
  profile: AgricultureFieldHeatProfile | null
  intel: SiteIntelligence | null
  workers: Worker[]
}): AgricultureAlert[] {
  if (!farm) return []
  const alerts: AgricultureAlert[] = []
  const fieldHref = field ? `/agriculture/fields?farm=${encodeURIComponent(farm.id)}&field=${encodeURIComponent(field.id)}` : `/agriculture/fields?farm=${encodeURIComponent(farm.id)}`
  const stressHref = field ? `/agriculture/crop-heat-stress?farm=${encodeURIComponent(farm.id)}&field=${encodeURIComponent(field.id)}` : `/agriculture/crop-heat-stress?farm=${encodeURIComponent(farm.id)}`
  const workHref = field ? `/agriculture/field-work?farm=${encodeURIComponent(farm.id)}&field=${encodeURIComponent(field.id)}` : `/agriculture/field-work?farm=${encodeURIComponent(farm.id)}`
  const irrigationHref = field ? `/agriculture/irrigation?farm=${encodeURIComponent(farm.id)}&field=${encodeURIComponent(field.id)}` : `/agriculture/irrigation?farm=${encodeURIComponent(farm.id)}`

  if (intel?.risk?.level === 'extreme' || intel?.risk?.level === 'high') {
    alerts.push({
      id: `${farm.id}:farm-atmospheric:${intel.risk.level}`,
      severity: intel.risk.level === 'extreme' ? 'critical' : 'high',
      title: `${intel.risk.level === 'extreme' ? 'Extreme' : 'High'} farm heat conditions`,
      summary: intel.risk.summary || 'Farm-level atmospheric heat risk is elevated.',
      evidence: intel.conditions ? `Heat index ${formatTemp(intel.conditions.heatIndexC)} · air temperature ${formatTemp(intel.conditions.temperatureC)} · ${intel.conditionSourceLabel || intel.conditionSource || 'verified condition source'}` : 'Farm-level risk is elevated, but detailed conditions are unavailable.',
      action: 'Review field work timing and worker controls before continuing exposed operations.',
      source: intel.conditionSourceLabel || intel.conditionSource || 'Farm conditions',
      href: workHref,
      observedAt: intel.observedAt,
    })
  }

  if (!field) {
    alerts.push({
      id: `${farm.id}:no-field`,
      severity: 'info',
      title: 'No field selected for thermal alert scanning',
      summary: 'Field-specific alerts require a saved field polygon.',
      evidence: 'HeatShield will not infer field heat from a single farm point.',
      action: 'Create or select a field boundary, then run the alert scan again.',
      source: 'HeatShield evidence gate',
      href: fieldHref,
    })
    return alerts
  }

  const workersInside = workers.filter((worker) => pointInPolygon(worker.coordinate, field.polygon))
  const directSun = workersInside.filter((worker) => worker.sunExposure === 'direct').length
  const heavyWork = workersInside.filter((worker) => worker.workIntensity === 'heavy').length

  if (!profile || profile.dataStatus === 'unavailable' || profile.dataStatus === 'configuration_required') {
    alerts.push({
      id: `${field.id}:evidence-unavailable`,
      severity: 'info',
      title: 'Field thermal evidence unavailable',
      summary: profile?.message || 'FortyGuard field heat evidence has not been verified for this field.',
      evidence: 'No synthetic field temperatures are used when provider cells are unavailable.',
      action: 'Refresh the scan or verify FortyGuard configuration before operational decisions.',
      source: 'FortyGuard evidence status',
      href: fieldHref,
      observedAt: profile?.generatedAt,
    })
    return alerts
  }

  const exceedance = profile.maxHoursAboveThreshold ?? 0
  const persistence = profile.maxPersistenceHours ?? 0
  const peak = profile.maxTemperatureC

  if (exceedance > 0 && persistence > 0) {
    alerts.push({
      id: `${field.id}:persistent-exceedance:${profile.date}:${profile.thresholdC}`,
      severity: exceedance >= 3 || persistence >= 3 ? 'high' : 'watch',
      title: 'Persistent field heat above screening threshold',
      summary: `${field.name} contains verified areas above the ${profile.thresholdC.toFixed(1)}°C screening threshold with persistent heat exposure.`,
      evidence: `Max exceedance ${formatHours(exceedance)} · longest persistence ${formatHours(persistence)} · peak ${formatTemp(peak)}.`,
      action: 'Inspect the hottest persistent zones and review crop stress and irrigation context before action.',
      source: 'FortyGuard exceedance + persistence',
      href: stressHref,
      observedAt: profile.generatedAt,
    })
  } else if (peak != null && peak >= profile.thresholdC) {
    alerts.push({
      id: `${field.id}:peak-threshold:${profile.date}:${profile.thresholdC}`,
      severity: 'watch',
      title: 'Field peak reached screening threshold',
      summary: `${field.name} reached or exceeded the configured thermal screening threshold.`,
      evidence: `Verified peak ${formatTemp(peak)} · screening threshold ${profile.thresholdC.toFixed(1)}°C.`,
      action: 'Open Crop Heat Stress to inspect the spatial pattern before deciding on treatment or irrigation.',
      source: 'FortyGuard TCM',
      href: stressHref,
      observedAt: profile.generatedAt,
    })
  }

  if (workersInside.length > 0 && (directSun > 0 || heavyWork > 0) && ((peak ?? -Infinity) >= profile.thresholdC || exceedance > 0)) {
    alerts.push({
      id: `${field.id}:crew-heat-context:${profile.date}`,
      severity: directSun > 0 && heavyWork > 0 ? 'high' : 'watch',
      title: 'Crew is mapped inside an elevated-heat field',
      summary: `${workersInside.length} worker${workersInside.length === 1 ? ' is' : 's are'} mapped inside ${field.name}; ${directSun} direct-sun and ${heavyWork} heavy-work assignment${heavyWork === 1 ? '' : 's'} are recorded.`,
      evidence: `Field peak ${formatTemp(peak)} · peak heat time ${profile.peakHourLocal || 'unavailable'} · worker positions come from saved HeatShield coordinates.`,
      action: 'Review field-work timing, breaks, hydration and supervisor controls before exposed work continues.',
      source: 'HeatShield crew context + FortyGuard field heat',
      href: workHref,
      observedAt: profile.generatedAt,
    })
  }

  if (persistence > 0 || exceedance > 0) {
    alerts.push({
      id: `${field.id}:irrigation-review:${profile.date}`,
      severity: persistence >= 3 ? 'watch' : 'info',
      title: 'Irrigation inspection priority',
      summary: 'Persistent or threshold-exceeding heat makes this field a higher-priority candidate for irrigation inspection.',
      evidence: `Persistence ${formatHours(persistence)} · threshold exceedance ${formatHours(exceedance)}. HeatShield does not infer soil moisture or prescribe water quantity from heat alone.`,
      action: 'Combine this thermal evidence with soil moisture, ET/crop demand and irrigation-system constraints.',
      source: 'FortyGuard thermal evidence + HeatShield decision gate',
      href: irrigationHref,
      observedAt: profile.generatedAt,
    })
  }

  const unavailableLayers = profile.layers.filter((layer) => layer.status !== 'verified')
  if (unavailableLayers.length) {
    alerts.push({
      id: `${field.id}:partial-evidence:${profile.date}`,
      severity: 'info',
      title: 'Partial field evidence coverage',
      summary: `${unavailableLayers.length} FortyGuard analytic layer${unavailableLayers.length === 1 ? ' is' : 's are'} unavailable for this scan.`,
      evidence: `Unavailable: ${unavailableLayers.map((layer) => layer.analyticType.replaceAll('_', ' ')).join(', ')}.`,
      action: 'Use verified layers only and avoid treating missing analytics as zero risk.',
      source: 'FortyGuard provenance',
      href: fieldHref,
      observedAt: profile.generatedAt,
    })
  }

  if (!alerts.length) {
    alerts.push({
      id: `${field.id}:routine:${profile.date}:${profile.thresholdC}`,
      severity: 'info',
      title: 'No elevated thermal trigger in this scan',
      summary: `${field.name} did not generate a threshold, persistence or crew-context alert from the currently loaded evidence.`,
      evidence: `Peak ${formatTemp(peak)} · max exceedance ${formatHours(exceedance)} · max persistence ${formatHours(persistence)}.`,
      action: 'Continue routine monitoring; this is not a guarantee of crop or worker safety.',
      source: 'HeatShield alert engine',
      href: stressHref,
      observedAt: profile.generatedAt,
    })
  }

  return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}

export function AgricultureAlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [farms, setFarms] = useState<Site[]>([])
  const [farmId, setFarmId] = useState<string | null>(null)
  const [fields, setFields] = useState<AgricultureField[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [profile, setProfile] = useState<AgricultureFieldHeatProfile | null>(null)
  const [intel, setIntel] = useState<SiteIntelligence | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [thresholdC, setThresholdC] = useState(DEFAULT_THRESHOLD_C)
  const [granularity, setGranularity] = useState<60 | 80 | 100>(100)
  const [severityFilter, setSeverityFilter] = useState<'all' | AlertSeverity>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | AlertStatus>('active')
  const [acknowledged, setAcknowledged] = useState<string[]>(initialAcknowledged)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api.listSites(controller.signal)
      .then((loaded) => {
        setFarms(loaded)
        const requested = searchParams.get('farm')
        setFarmId(requested && loaded.some((item) => item.id === requested) ? requested : loaded[0]?.id ?? null)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load farms.'))
      .finally(() => setLoading(false))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!farmId) {
      setFields([])
      setFieldId(null)
      setIntel(null)
      setWorkers([])
      setProfile(null)
      return
    }
    const controller = new AbortController()
    setError(null)
    Promise.all([
      agricultureApi.listFields(farmId, controller.signal),
      api.getSiteIntelligence(farmId, controller.signal),
      api.listWorkers(farmId, controller.signal),
    ])
      .then(([loadedFields, loadedIntel, loadedWorkers]) => {
        setFields(loadedFields)
        setIntel(loadedIntel)
        setWorkers(loadedWorkers)
        const requested = searchParams.get('field')
        const preferred = requested && loadedFields.some((item) => item.id === requested) ? requested : loadedFields[0]?.id ?? null
        setFieldId(preferred)
        const next = new URLSearchParams(searchParams)
        next.set('farm', farmId)
        if (preferred) next.set('field', preferred); else next.delete('field')
        setSearchParams(next, { replace: true })
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load alert context.') })
    return () => controller.abort()
  }, [farmId, refreshKey])

  useEffect(() => {
    if (!farmId || !fieldId) {
      setProfile(null)
      return
    }
    const controller = new AbortController()
    setScanning(true)
    setError(null)
    agricultureApi.generateFieldHeatProfile(farmId, fieldId, { thresholdC, granularityMeters: granularity }, controller.signal)
      .then(setProfile)
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setProfile(null); setError(cause instanceof Error ? cause.message : 'Unable to run field alert scan.') } })
      .finally(() => { if (!controller.signal.aborted) setScanning(false) })
    return () => controller.abort()
  }, [farmId, fieldId, thresholdC, granularity, refreshKey])

  const farm = useMemo(() => farms.find((item) => item.id === farmId) ?? null, [farms, farmId])
  const field = useMemo(() => fields.find((item) => item.id === fieldId) ?? null, [fields, fieldId])
  const alerts = useMemo(() => buildAlerts({ farm, field, profile, intel, workers }), [farm, field, profile, intel, workers])
  const activeCount = alerts.filter((alert) => !acknowledged.includes(alert.id)).length
  const highCount = alerts.filter((alert) => !acknowledged.includes(alert.id) && (alert.severity === 'critical' || alert.severity === 'high')).length
  const watchCount = alerts.filter((alert) => !acknowledged.includes(alert.id) && alert.severity === 'watch').length
  const verifiedLayerCount = profile?.layers.filter((layer) => layer.status === 'verified').length ?? 0

  const visibleAlerts = alerts.filter((alert) => {
    const status: AlertStatus = acknowledged.includes(alert.id) ? 'acknowledged' : 'active'
    if (severityFilter !== 'all' && alert.severity !== severityFilter) return false
    if (statusFilter !== 'all' && status !== statusFilter) return false
    return true
  })

  const setAck = (id: string, next: boolean) => {
    const updated = next ? Array.from(new Set([...acknowledged, id])) : acknowledged.filter((item) => item !== id)
    setAcknowledged(updated)
    window.localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(updated))
  }

  const changeFarm = (value: string) => {
    setFarmId(value)
    setFieldId(null)
    setProfile(null)
  }

  const changeField = (value: string) => {
    setFieldId(value)
    setProfile(null)
    const next = new URLSearchParams(searchParams)
    if (farmId) next.set('farm', farmId)
    next.set('field', value)
    setSearchParams(next, { replace: true })
  }

  return (
    <AppShell module="agriculture">
      <header className="agri-alerts-topbar">
        <div><h1>Agriculture Alerts</h1><span>Evidence-backed alert triage for farm conditions, exact field heat, crews and irrigation review.</span></div>
        <div className="agri-alerts-topbar__spacer" />
        <div className="agri-alerts-core-badge"><span /><div><small>INTELLIGENCE CORE</small><strong>FortyGuard + HeatShield</strong></div></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </header>

      <main className="agri-alerts-page">
        <section className="agri-alerts-controls panel">
          <label><span>FARM</span><select value={farmId ?? ''} onChange={(event) => changeFarm(event.target.value)} disabled={loading}>{!farms.length && <option value="">No farms</option>}{farms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>FIELD</span><select value={fieldId ?? ''} onChange={(event) => changeField(event.target.value)} disabled={!farmId || !fields.length}>{!fields.length && <option value="">No fields</option>}{fields.map((item) => <option key={item.id} value={item.id}>{item.name}{item.crop ? ` · ${item.crop}` : ''}</option>)}</select></label>
          <label><span>SCREENING THRESHOLD</span><select value={thresholdC} onChange={(event) => setThresholdC(Number(event.target.value))}><option value={32}>32°C</option><option value={35}>35°C</option><option value={38}>38°C</option><option value={40}>40°C</option></select><small>User-configured thermal trigger</small></label>
          <label><span>RESOLUTION</span><select value={granularity} onChange={(event) => setGranularity(Number(event.target.value) as 60 | 80 | 100)}><option value={60}>60 m</option><option value={80}>80 m</option><option value={100}>100 m</option></select></label>
          <button type="button" className="agri-alerts-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={!farmId || scanning}>{scanning ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />} Run alert scan</button>
        </section>

        {error && <div className="agri-alerts-error"><AlertTriangle size={16} />{error}</div>}

        <section className="agri-alerts-kpis">
          <article className="panel"><div className="agri-alerts-kpi-icon is-red"><BellRing size={19} /></div><div><span>ACTIVE ALERTS</span><strong>{activeCount}</strong><small>Current field-scoped scan</small></div></article>
          <article className="panel"><div className="agri-alerts-kpi-icon is-orange"><ShieldAlert size={19} /></div><div><span>HIGH PRIORITY</span><strong>{highCount}</strong><small>Critical + high</small></div></article>
          <article className="panel"><div className="agri-alerts-kpi-icon is-amber"><AlertCircle size={19} /></div><div><span>WATCH</span><strong>{watchCount}</strong><small>Needs review, not diagnosis</small></div></article>
          <article className="panel"><div className="agri-alerts-kpi-icon is-teal"><ShieldCheck size={19} /></div><div><span>VERIFIED LAYERS</span><strong>{verifiedLayerCount}/4</strong><small>{profile ? `${profile.providerRequestCount} provider request${profile.providerRequestCount === 1 ? '' : 's'}` : 'Awaiting scan'}</small></div></article>
        </section>

        <section className="agri-alerts-agent panel">
          <div className="agri-alerts-agent__icon"><Bell size={20} /></div>
          <div><span className="agri-alerts-eyebrow">ALERT ENGINE</span><strong>{field ? `${field.name} evidence scan` : 'Farm alert scan'}</strong><p>{field && profile ? `HeatShield is comparing verified field TCM, exceedance and persistence with farm atmospheric risk and saved crew positions. ${profile.peakHourLocal ? `Peak field heat is near ${profile.peakHourLocal}.` : ''}` : 'Select a saved field to generate field-specific thermal alerts. HeatShield does not substitute farm weather for missing field cells.'}</p></div>
          <div className="agri-alerts-agent__facts"><span><ThermometerSun size={14} /> Peak {formatTemp(profile?.maxTemperatureC)}</span><span><Clock3 size={14} /> Persistence {formatHours(profile?.maxPersistenceHours)}</span><span><Gauge size={14} /> Exceedance {formatHours(profile?.maxHoursAboveThreshold)}</span></div>
        </section>

        <section className="agri-alerts-workspace">
          <div className="agri-alerts-feed panel">
            <div className="agri-alerts-section-head"><div><span className="agri-alerts-eyebrow">ALERT FEED</span><h2>Evidence-ranked alerts</h2><p>Acknowledging an alert marks it reviewed in this browser; it does not dismiss the underlying thermal condition.</p></div><div className="agri-alerts-filters"><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as 'all' | AlertSeverity)}><option value="all">All severity</option><option value="critical">Critical</option><option value="high">High</option><option value="watch">Watch</option><option value="info">Info</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | AlertStatus)}><option value="active">Active</option><option value="acknowledged">Acknowledged</option><option value="all">All status</option></select></div></div>

            <div className="agri-alerts-list">
              {!visibleAlerts.length && <div className="agri-alerts-empty"><CheckCircle2 size={28} /><strong>No alerts match these filters.</strong><span>Change filters or refresh the field scan.</span></div>}
              {visibleAlerts.map((alert) => {
                const isAck = acknowledged.includes(alert.id)
                return <article key={alert.id} className={`agri-alert-row is-${alert.severity}${isAck ? ' is-acknowledged' : ''}`}>
                  <div className="agri-alert-row__signal">{alert.severity === 'critical' || alert.severity === 'high' ? <AlertTriangle size={18} /> : alert.severity === 'watch' ? <AlertCircle size={18} /> : <CircleDot size={18} />}</div>
                  <div className="agri-alert-row__copy"><div className="agri-alert-row__meta"><span className={`agri-alert-severity is-${alert.severity}`}>{severityLabel(alert.severity)}</span><span>{alert.source}</span><span>{formatObserved(alert.observedAt)}</span></div><h3>{alert.title}</h3><p>{alert.summary}</p><div className="agri-alert-evidence"><ShieldCheck size={14} /><span>{alert.evidence}</span></div><div className="agri-alert-action"><strong>Recommended review:</strong> {alert.action}</div></div>
                  <div className="agri-alert-row__actions"><button type="button" onClick={() => setAck(alert.id, !isAck)} className={isAck ? 'is-ack' : ''}>{isAck ? <><Check size={15} /> Reviewed</> : 'Acknowledge'}</button><Link to={alert.href}>Open context <ChevronRight size={15} /></Link></div>
                </article>
              })}
            </div>
          </div>

          <aside className="agri-alerts-side">
            <section className="panel agri-alerts-card"><span className="agri-alerts-eyebrow">EVIDENCE STATUS</span><h3>Scan provenance</h3><div className="agri-alerts-provenance"><div><span>Farm</span><strong>{farm?.name || '—'}</strong></div><div><span>Field</span><strong>{field?.name || '—'}</strong></div><div><span>Field date</span><strong>{profile?.date || '—'}</strong></div><div><span>Threshold</span><strong>{profile ? `${profile.thresholdC.toFixed(1)}°C` : `${thresholdC.toFixed(1)}°C`}</strong></div><div><span>Thermal status</span><strong className={profile?.dataStatus === 'verified' ? 'is-verified' : ''}>{profile?.dataStatus || 'Awaiting scan'}</strong></div></div></section>

            <section className="panel agri-alerts-card"><span className="agri-alerts-eyebrow">ALERT RULES</span><h3>What can trigger here</h3><div className="agri-alerts-rule-list"><div><ThermometerSun size={16} /><span><strong>Field heat</strong><small>Peak temperature at/above the configured screening threshold.</small></span></div><div><Clock3 size={16} /><span><strong>Persistent heat</strong><small>Verified exceedance + persistence from FortyGuard layers.</small></span></div><div><Users size={16} /><span><strong>Crew context</strong><small>Mapped workers inside the exact field plus recorded sun/workload context.</small></span></div><div><Sprout size={16} /><span><strong>Irrigation review</strong><small>Inspection priority only; no water prescription without soil/ET inputs.</small></span></div></div></section>

            <section className="panel agri-alerts-card agri-alerts-card--notice"><ShieldCheck size={20} /><div><strong>Evidence-safe alerts</strong><p>HeatShield alerts surface conditions that deserve review. They are not crop-damage diagnoses, medical alerts, occupational exposure limits or automatic irrigation commands.</p></div></section>
          </aside>
        </section>
      </main>
    </AppShell>
  )
}
