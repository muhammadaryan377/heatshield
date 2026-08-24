import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crosshair,
  Gauge,
  History,
  Layers3,
  MapPin,
  RefreshCw,
  Repeat2,
  ShieldCheck,
  ThermometerSun,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import { filterUrbanDistricts } from '../lib/urbanDistricts'
import type { Coordinate, Site, ThermalMapResponse, ThermalTile } from '../types/site'
import type {
  UrbanBeforeAfterInterpretation,
  UrbanBeforeAfterVerification,
  UrbanIntervention,
} from '../types/urban'
import '../urban-before-after.css'

const SELECTED_DISTRICT_KEY = 'heatshield:selected-urban-district'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const GRANULARITY_METERS = 80 as const

type MapMode = 'before' | 'after'

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function temperature(value?: number | null, digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}°C`
}

function signedTemperature(value?: number | null, digits = 1) {
  if (value == null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}°C`
}

function observedLabel(value?: string | null) {
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

function shortObservedLabel(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = clamp((value - min) / span)
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#52a96b'
  if (ratio < 0.52) return '#c8b63e'
  if (ratio < 0.70) return '#ee9b2c'
  if (ratio < 0.86) return '#eb6635'
  return '#ca3948'
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
    if (pointOnSegment(point, polygon[index - 1] ?? polygon[polygon.length - 1], polygon[index])) return true
  }
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    const denominator = previous.lat - current.lat
    const intersects = ((current.lat > point.lat) !== (previous.lat > point.lat))
      && Math.abs(denominator) > Number.EPSILON
      && point.lng < (previous.lng - current.lng) * (point.lat - current.lat) / denominator + current.lng
    if (intersects) inside = !inside
  }
  return inside
}

function targetTile(thermal: ThermalMapResponse | null | undefined, point: Coordinate): ThermalTile | null {
  if (thermal?.dataStatus !== 'verified') return null
  return thermal.tiles.find((tile) => pointInPolygon(point, tile.polygon)) ?? null
}

function interpretationLabel(value: UrbanBeforeAfterInterpretation) {
  if (value === 'relative_cooling_signal') return 'Relative cooling signal'
  if (value === 'relative_warming_signal') return 'Relative warming signal'
  if (value === 'no_clear_change') return 'No clear directional change'
  return 'Comparison blocked'
}

function interpretationTone(value?: UrbanBeforeAfterInterpretation | null) {
  if (value === 'relative_cooling_signal') return 'positive'
  if (value === 'relative_warming_signal') return 'warning'
  if (value === 'no_clear_change') return 'neutral'
  return 'blocked'
}

function interventionLabel(intervention: UrbanIntervention) {
  const label = intervention.type.replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function VerificationMap({
  mode,
  district,
  intervention,
  verification,
}: {
  mode: MapMode
  district: Site
  intervention: UrbanIntervention
  verification: UrbanBeforeAfterVerification | null
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const baselineRef = useRef<google.maps.Polygon | google.maps.Circle | null>(null)
  const thermalRefs = useRef<google.maps.Polygon[]>([])
  const targetRef = useRef<google.maps.Polygon | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const [mapVersion, setMapVersion] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

  const targetPoint = useMemo(() => ({
    lat: intervention.evidence.latitude,
    lng: intervention.evidence.longitude,
  }), [intervention.evidence.latitude, intervention.evidence.longitude])

  useEffect(() => {
    if (!mapsApiKey || !mapElement.current) return
    let cancelled = false
    setMapError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return
        const map = new googleInstance.maps.Map(mapElement.current, {
          center: targetPoint,
          zoom: 17,
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          gestureHandling: 'greedy',
        })
        mapRef.current = map
        boundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: district.polygon,
          strokeColor: '#f8ffff',
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          fillColor: '#0b8b87',
          fillOpacity: 0.015,
          clickable: false,
          zIndex: 30,
        })
        setMapVersion((value) => value + 1)
      })
      .catch((cause: Error) => {
        if (!cancelled) setMapError(cause.message)
      })

    return () => {
      cancelled = true
      boundaryRef.current?.setMap(null)
      baselineRef.current?.setMap(null)
      targetRef.current?.setMap(null)
      markerRef.current?.setMap(null)
      thermalRefs.current.forEach((polygon) => polygon.setMap(null))
      boundaryRef.current = null
      baselineRef.current = null
      targetRef.current = null
      markerRef.current = null
      thermalRefs.current = []
      mapRef.current = null
    }
  }, [district.id, district.polygon, targetPoint.lat, targetPoint.lng])

  useEffect(() => {
    baselineRef.current?.setMap(null)
    targetRef.current?.setMap(null)
    markerRef.current?.setMap(null)
    thermalRefs.current.forEach((polygon) => polygon.setMap(null))
    baselineRef.current = null
    targetRef.current = null
    markerRef.current = null
    thermalRefs.current = []

    const map = mapRef.current
    if (!map || !window.google?.maps) return

    if (mode === 'before') {
      if (intervention.evidence.cellPolygon.length >= 3) {
        baselineRef.current = new google.maps.Polygon({
          map,
          paths: intervention.evidence.cellPolygon,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 3.5,
          fillColor: '#d2484d',
          fillOpacity: 0.32,
          zIndex: 45,
        })
      } else {
        baselineRef.current = new google.maps.Circle({
          map,
          center: targetPoint,
          radius: 38,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#d2484d',
          fillOpacity: 0.25,
          zIndex: 45,
        })
      }
    } else {
      const thermal = verification?.afterThermal
      if (thermal?.dataStatus === 'verified' && thermal.tiles.length) {
        const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
        const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))
        thermalRefs.current = thermal.tiles.map((tile) => {
          const color = heatColor(tile.temperatureC, min, max)
          return new google.maps.Polygon({
            map,
            paths: tile.polygon,
            strokeColor: color,
            strokeOpacity: 0.82,
            strokeWeight: 0.65,
            fillColor: color,
            fillOpacity: 0.48,
            clickable: false,
            zIndex: 10,
          })
        })
        const matched = targetTile(thermal, targetPoint)
        if (matched) {
          targetRef.current = new google.maps.Polygon({
            map,
            paths: matched.polygon,
            strokeColor: '#ffffff',
            strokeOpacity: 1,
            strokeWeight: 4,
            fillColor: '#ffffff',
            fillOpacity: 0.04,
            zIndex: 48,
          })
        }
      }
    }

    markerRef.current = new google.maps.Marker({
      map,
      position: targetPoint,
      zIndex: 60,
      title: mode === 'before' ? 'Locked baseline target' : 'Post-intervention target',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: mode === 'before' ? '#d2484d' : '#178f82',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2.4,
      },
    })
  }, [intervention.evidence.cellPolygon, mapVersion, mode, targetPoint, verification])

  const afterReady = verification?.afterThermal?.dataStatus === 'verified'

  return (
    <div className="uba-map">
      {mapsApiKey && !mapError ? <div ref={mapElement} className="uba-map__google" /> : (
        <div className="uba-map__fallback">
          <Layers3 size={28} />
          <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
          <span>The verification math still works; satellite context requires Google Maps.</span>
        </div>
      )}
      <div className="uba-map__chip">
        {mode === 'before' ? <ShieldCheck size={14} /> : <Repeat2 size={14} />}
        {mode === 'before'
          ? 'Locked FortyGuard baseline target'
          : afterReady ? 'Verified post-intervention layer' : 'Post-intervention layer pending'}
      </div>
      {mode === 'after' && afterReady && <div className="uba-map__legend"><span>Cooler</span><i /><span>Hotter</span></div>}
    </div>
  )
}

function Gate({ ready, title, detail }: { ready: boolean; title: string; detail: string }) {
  return (
    <article className={`uba-gate${ready ? ' is-ready' : ''}`}>
      <span>{ready ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </article>
  )
}

export function UrbanBeforeAfterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [districts, setDistricts] = useState<Site[]>([])
  const [districtId, setDistrictId] = useState<string | null>(null)
  const [interventions, setInterventions] = useState<UrbanIntervention[]>([])
  const [interventionId, setInterventionId] = useState<string | null>(null)
  const [verificationHistory, setVerificationHistory] = useState<UrbanBeforeAfterVerification[]>([])
  const [currentVerification, setCurrentVerification] = useState<UrbanBeforeAfterVerification | null>(null)
  const [loadingDistricts, setLoadingDistricts] = useState(true)
  const [loadingInterventions, setLoadingInterventions] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [toleranceMinutes, setToleranceMinutes] = useState(90)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoadingDistricts(true)
    api.listSites(controller.signal)
      .then((sites) => {
        if (!active || controller.signal.aborted) return
        const urban = filterUrbanDistricts(sites)
        setDistricts(urban)
        const requested = searchParams.get('district')
        const stored = localStorage.getItem(SELECTED_DISTRICT_KEY)
        const preferred = [requested, stored].find((id) => id && urban.some((site) => site.id === id))
        setDistrictId(preferred ?? urban[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to load urban districts.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingDistricts(false)
      })
    return () => { active = false; controller.abort() }
    // Initial route preference only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!districtId) {
      setInterventions([])
      setInterventionId(null)
      return
    }
    localStorage.setItem(SELECTED_DISTRICT_KEY, districtId)
    const controller = new AbortController()
    let active = true
    setLoadingInterventions(true)
    setError(null)
    setCurrentVerification(null)
    api.listUrbanInterventions(districtId, controller.signal)
      .then((loaded) => {
        if (!active || controller.signal.aborted) return
        setInterventions(loaded)
        const requested = searchParams.get('intervention')
        const preferred = requested && loaded.some((item) => item.id === requested)
          ? requested
          : loaded.find((item) => item.status === 'completed')?.id
            ?? loaded.find((item) => item.status === 'archived' && item.completedAt)?.id
            ?? loaded[0]?.id
            ?? null
        setInterventionId(preferred)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Could not load interventions for this district.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingInterventions(false)
      })
    return () => { active = false; controller.abort() }
  }, [districtId])

  useEffect(() => {
    if (!districtId || !interventionId) {
      setVerificationHistory([])
      setCurrentVerification(null)
      return
    }
    const controller = new AbortController()
    let active = true
    setLoadingHistory(true)
    setCurrentVerification(null)
    api.listUrbanBeforeAfterVerifications(districtId, interventionId, controller.signal)
      .then((loaded) => {
        if (active && !controller.signal.aborted) setVerificationHistory(loaded)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Could not load previous verification runs.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoadingHistory(false)
      })
    return () => { active = false; controller.abort() }
  }, [districtId, interventionId])

  const district = useMemo(() => districts.find((site) => site.id === districtId) ?? null, [districtId, districts])
  const intervention = useMemo(
    () => interventions.find((item) => item.id === interventionId) ?? null,
    [interventionId, interventions],
  )
  const verification = currentVerification ?? verificationHistory[0] ?? null
  const completionReady = Boolean(intervention?.completedAt && ['completed', 'archived'].includes(intervention.status))

  useEffect(() => {
    if (!districtId) return
    const next = new URLSearchParams(searchParams)
    next.set('district', districtId)
    if (interventionId) next.set('intervention', interventionId)
    else next.delete('intervention')
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [districtId, interventionId, searchParams, setSearchParams])

  const verify = useCallback(async () => {
    if (!districtId || !interventionId || verifying) return
    setVerifying(true)
    setError(null)
    try {
      const result = await api.verifyUrbanIntervention(districtId, interventionId, {
        granularityMeters: GRANULARITY_METERS,
        localTimeToleranceMinutes: toleranceMinutes,
      })
      setCurrentVerification(result)
      if (result.id) {
        setVerificationHistory((current) => [result, ...current.filter((item) => item.id !== result.id)])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not run FortyGuard Before / After verification.')
    } finally {
      setVerifying(false)
    }
  }, [districtId, interventionId, toleranceMinutes, verifying])

  const rawChange = verification?.rawTemperatureChangeC ?? null
  const anomalyChange = verification?.anomalyChangeC ?? null
  const tone = interpretationTone(verification?.interpretation)

  return (
    <AppShell module="urban">
      <div className="topbar">
        <h1 className="topbar__title">Urban Heat Intelligence</h1>
        <div className="topbar__spacer" />
        <div className="module-core-status"><span className="module-core-status__dot" /><span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span></div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </div>

      <main className="uba-page">
        <section className="uba-hero panel">
          <div>
            <span className="uba-eyebrow">SCREEN 06 • BEFORE / AFTER</span>
            <h1>Measure what changed after the intervention.</h1>
            <p>Compare the locked FortyGuard baseline with a new post-completion thermal layer. HeatShield separates raw temperature change from district-normalized change and blocks outcome claims when timing or spatial evidence is not comparable.</p>
          </div>
          <div className={`uba-verdict uba-verdict--${tone}`}>
            <Repeat2 size={21} />
            <span><small>OUTCOME STATE</small><strong>{verification ? interpretationLabel(verification.interpretation) : 'Awaiting verification'}</strong></span>
          </div>
        </section>

        <section className="uba-controls panel">
          <label><span>District</span><div><MapPin size={15} /><select value={districtId ?? ''} onChange={(event) => { setDistrictId(event.target.value || null); setInterventionId(null) }} disabled={!districts.length}>{!districts.length && <option value="">No districts</option>}{districts.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div></label>
          <label><span>Intervention</span><div><Crosshair size={15} /><select value={interventionId ?? ''} onChange={(event) => setInterventionId(event.target.value || null)} disabled={!interventions.length || loadingInterventions}>{!interventions.length && <option value="">No saved interventions</option>}{interventions.map((item) => <option key={item.id} value={item.id}>{item.title} • {item.status.replaceAll('_', ' ')}</option>)}</select></div></label>
          <label><span>Local-time tolerance</span><div><Clock3 size={15} /><select value={toleranceMinutes} onChange={(event) => setToleranceMinutes(Number(event.target.value))}><option value={60}>±60 min</option><option value={90}>±90 min</option><option value={120}>±120 min</option></select></div></label>
          <button type="button" className="button button--primary uba-run" onClick={verify} disabled={!completionReady || verifying}>
            {verifying ? <RefreshCw className="spin" size={16} /> : <ShieldCheck size={16} />}
            {verifying ? 'Requesting FortyGuard…' : 'Run verification'}
          </button>
        </section>

        {loadingDistricts && <StatePanel kind="loading" title="Loading verification workspace" detail="Preparing urban districts and saved intervention baselines…" />}
        {!loadingDistricts && !district && <section className="uba-empty panel"><MapPin size={30} /><div><h2>No urban district is available.</h2><p>Create a district before building and verifying interventions.</p></div><Link to="/urban/districts" className="button button--primary">Open Districts <ArrowRight size={14} /></Link></section>}
        {district && !loadingInterventions && !intervention && <section className="uba-empty panel"><Repeat2 size={30} /><div><h2>No intervention is available for this district.</h2><p>Screen 6 requires a saved intervention with a locked FortyGuard baseline.</p></div><Link to={`/urban/interventions?district=${encodeURIComponent(district.id)}`} className="button button--primary">Open Interventions <ArrowRight size={14} /></Link></section>}

        {district && intervention && (
          <>
            {error && <div className="uba-warning"><AlertTriangle size={16} /><span>{error}</span></div>}

            <section className="uba-context panel">
              <div><span className="uba-context__icon"><Repeat2 size={18} /></span><div><small>Intervention</small><strong>{intervention.title}</strong><span>{interventionLabel(intervention)} • {intervention.status.replaceAll('_', ' ')}</span></div></div>
              <div><span className="uba-context__icon"><Clock3 size={18} /></span><div><small>Baseline</small><strong>{shortObservedLabel(intervention.evidence.baselineObservedAt)}</strong><span>Locked before planning approval</span></div></div>
              <div><span className="uba-context__icon"><ShieldCheck size={18} /></span><div><small>Completion</small><strong>{intervention.completedAt ? shortObservedLabel(intervention.completedAt) : 'Not completed'}</strong><span>{completionReady ? 'Eligible for post-action measurement' : 'Finish Screen 5 workflow first'}</span></div></div>
            </section>

            {!completionReady && <section className="uba-not-ready panel"><AlertTriangle size={22} /><div><h2>Verification gate is closed.</h2><p>This intervention is still <strong>{intervention.status.replaceAll('_', ' ')}</strong>. Mark it completed only after the physical action is implemented; then Screen 6 will require a later FortyGuard observation.</p></div><Link to={`/urban/interventions?district=${encodeURIComponent(district.id)}&cell=${encodeURIComponent(intervention.evidence.cellId)}`} className="button button--secondary">Return to Interventions</Link></section>}

            <section className="uba-metrics">
              <article className="uba-metric panel"><ThermometerSun size={18} /><div><small>Before target</small><strong>{temperature(intervention.evidence.baselineTemperatureC)}</strong><span>district mean {temperature(intervention.evidence.districtMeanTemperatureC)}</span></div></article>
              <article className="uba-metric panel"><ThermometerSun size={18} /><div><small>After target</small><strong>{temperature(verification?.afterTemperatureC)}</strong><span>{verification?.afterObservedAt ? shortObservedLabel(verification.afterObservedAt) : 'Run a post-completion check'}</span></div></article>
              <article className="uba-metric panel"><Gauge size={18} /><div><small>Raw target change</small><strong>{signedTemperature(rawChange)}</strong><span>after target − before target</span></div></article>
              <article className={`uba-metric panel uba-metric--${tone}`}><Repeat2 size={18} /><div><small>Normalized anomaly change</small><strong>{signedTemperature(anomalyChange)}</strong><span>(target − district mean), after − before</span></div></article>
            </section>

            <section className="uba-gates panel">
              <div className="uba-section-head"><div><span className="uba-eyebrow">COMPARABILITY GATE</span><h2>Can these observations support a directional signal?</h2><p>All critical checks must pass before HeatShield labels a relative cooling or warming signal.</p></div><span className={`uba-strength uba-strength--${verification?.evidenceStrength ?? 'insufficient'}`}>{verification?.evidenceStrength ?? 'insufficient'} evidence</span></div>
              <div className="uba-gate-grid">
                <Gate ready={completionReady} title="Physical action completed" detail={intervention.completedAt ? `Recorded ${observedLabel(intervention.completedAt)}` : 'Completion timestamp is required.'} />
                <Gate ready={Boolean(verification?.afterObservationAfterCompletion)} title="Observation is post-completion" detail={verification?.afterObservedAt ? observedLabel(verification.afterObservedAt) : 'A new provider observation has not been checked.'} />
                <Gate ready={Boolean(verification?.targetCellMatched)} title="Target coordinate matched" detail={verification?.targetCellMatched ? 'A FortyGuard cell contains the locked intervention coordinate.' : 'No post-action spatial target match yet.'} />
                <Gate ready={Boolean(verification?.timeMatched)} title="Local clock time matched" detail={verification?.localClockDifferenceMinutes != null ? `${verification.localClockDifferenceMinutes} min difference • tolerance ${verification.localTimeToleranceMinutes} min` : `Requires a comparison within ${toleranceMinutes} minutes of baseline local clock time.`} />
              </div>
            </section>

            <section className="uba-maps">
              <article className="uba-map-card panel">
                <div className="uba-card-head"><div><span className="uba-eyebrow">BEFORE • LOCKED BASELINE</span><h2>{temperature(intervention.evidence.baselineTemperatureC)}</h2><small>{observedLabel(intervention.evidence.baselineObservedAt)}</small></div><span className="uba-anomaly">anomaly {signedTemperature(intervention.evidence.anomalyC)}</span></div>
                <VerificationMap mode="before" district={district} intervention={intervention} verification={verification} />
              </article>
              <article className="uba-map-card panel">
                <div className="uba-card-head"><div><span className="uba-eyebrow">AFTER • VERIFIED OBSERVATION</span><h2>{temperature(verification?.afterTemperatureC)}</h2><small>{observedLabel(verification?.afterObservedAt)}</small></div><span className="uba-anomaly">anomaly {signedTemperature(verification?.afterAnomalyC)}</span></div>
                <VerificationMap mode="after" district={district} intervention={intervention} verification={verification} />
              </article>
            </section>

            <section className={`uba-result panel uba-result--${tone}`}>
              <span className="uba-result__icon">{verification?.dataStatus === 'verified' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}</span>
              <div><span className="uba-eyebrow">MEASURED OUTCOME INTERPRETATION</span><h2>{verification ? interpretationLabel(verification.interpretation) : 'No post-intervention result yet'}</h2><p>{verification?.message ?? 'Run verification after the intervention is completed. HeatShield will request a new FortyGuard layer and evaluate whether the observation is comparable to the locked baseline.'}</p></div>
            </section>

            <section className="uba-evidence panel">
              <div className="uba-section-head"><div><span className="uba-eyebrow">EVIDENCE LEDGER</span><h2>Before vs After values</h2><p>The raw delta and background-normalized delta are shown separately so changing district-wide heat is not mistaken for local intervention performance.</p></div></div>
              <div className="uba-table">
                <div className="uba-table__head"><span>Metric</span><b>Before</b><b>After</b><b>Change</b></div>
                <div><span>Target surface temperature</span><b>{temperature(intervention.evidence.baselineTemperatureC)}</b><b>{temperature(verification?.afterTemperatureC)}</b><b>{signedTemperature(verification?.rawTemperatureChangeC)}</b></div>
                <div><span>District mean surface</span><b>{temperature(intervention.evidence.districtMeanTemperatureC)}</b><b>{temperature(verification?.afterDistrictMeanC)}</b><b>{verification?.afterDistrictMeanC == null ? '—' : signedTemperature(verification.afterDistrictMeanC - intervention.evidence.districtMeanTemperatureC)}</b></div>
                <div><span>Target anomaly vs district</span><b>{signedTemperature(intervention.evidence.anomalyC)}</b><b>{signedTemperature(verification?.afterAnomalyC)}</b><b>{signedTemperature(verification?.anomalyChangeC)}</b></div>
                <div><span>Observation local-time alignment</span><b>{shortObservedLabel(intervention.evidence.baselineObservedAt)}</b><b>{shortObservedLabel(verification?.afterObservedAt)}</b><b>{verification?.localClockDifferenceMinutes == null ? '—' : `${verification.localClockDifferenceMinutes} min`}</b></div>
              </div>
            </section>

            <section className="uba-history panel">
              <div className="uba-section-head"><div><span className="uba-eyebrow">VERIFICATION HISTORY</span><h2>Repeat measurements, not one-off claims.</h2><p>Comparable runs are persisted so reviewers can see whether the directional signal repeats.</p></div><span className="uba-history-count"><History size={14} /> {verificationHistory.length} saved</span></div>
              {loadingHistory ? <div className="uba-history-empty"><RefreshCw className="spin" size={18} /> Loading previous runs…</div> : verificationHistory.length ? (
                <div className="uba-history-list">{verificationHistory.map((item) => <article key={item.id ?? item.generatedAt}><span className={`uba-history-dot uba-history-dot--${interpretationTone(item.interpretation)}`} /><div><strong>{interpretationLabel(item.interpretation)}</strong><small>{observedLabel(item.afterObservedAt)} • {item.timeMatched ? 'time matched' : 'context only'}</small></div><b>{signedTemperature(item.anomalyChangeC)}</b><em>{item.evidenceStrength}</em></article>)}</div>
              ) : <div className="uba-history-empty"><History size={20} /><span>No saved post-completion verification runs yet.</span></div>}
            </section>

            <section className="uba-method panel">
              <Gauge size={20} />
              <div><strong>Scientific guardrail</strong><p><b>Raw target change</b> can move because the whole district is hotter or cooler on another day. HeatShield therefore also computes <b>anomaly change = (after target − after district mean) − (before target − before district mean)</b>. Even when time-matched, this is a relative observational signal—not randomized causal proof. A ±0.5°C screening band is used only to avoid labeling tiny normalized changes as directional outcomes.</p></div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
