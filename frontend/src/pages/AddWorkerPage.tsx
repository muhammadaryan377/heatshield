import {
  Check,
  ClipboardCheck,
  Clock3,
  Droplets,
  MapPin,
  ShieldCheck,
  Sun,
  ThermometerSun,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import type {
  Coordinate,
  RiskLevel,
  Site,
  SiteIntelligence,
  Worker,
  WorkerCreate,
  WorkerStatus,
} from '../types/site'

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const STORAGE_KEY = 'heatshield:selected-site'

type WorkerDraft = Omit<WorkerCreate, 'coordinate'>
type WorkIntensity = NonNullable<WorkerCreate['workIntensity']>

const TASK_OPTIONS = [
  'Roofing',
  'Loading / unloading',
  'Material handling',
  'Concrete work',
  'Excavation',
  'Landscaping',
  'Welding',
  'Electrical work',
  'Equipment operation',
  'Inspection',
  'Maintenance',
  'Supervision',
]

function makeWorkerCode() {
  const suffix = `${Date.now()}`.slice(-6)
  return `WKR-${suffix}`
}

function emptyDraft(): WorkerDraft {
  return {
    workerCode: makeWorkerCode(),
    name: '',
    role: '',
    team: '',
    location: 'Site area',
    locationId: 'site-area',
    task: '',
    workIntensity: 'moderate',
    shiftStart: '',
    shiftEnd: '',
    sunExposure: 'direct',
    shadeAccess: 'limited',
    waterAccess: true,
    supervisor: '',
    status: 'active',
    notes: '',
  }
}

function pointInsidePolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng
    const yi = polygon[i].lat
    const xj = polygon[j].lng
    const yj = polygon[j].lat
    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function locationId(value: string) {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return normalized || 'site-area'
}

function displayStatus(value: WorkerStatus) {
  if (value === 'offsite') return 'Off site'
  if (value === 'break') return 'On break'
  return 'Active'
}

function intensityLabel(value: WorkIntensity | undefined) {
  if (value === 'heavy') return 'High'
  if (value === 'light') return 'Low'
  return 'Moderate'
}

function inferWorkIntensity(task?: string): WorkIntensity | null {
  const value = task?.toLowerCase().trim() ?? ''
  if (!value) return null

  if (/(roof|load|unload|material hand|concrete|excavat|heavy lift|demolition)/.test(value)) return 'heavy'
  if (/(inspect|supervis|survey|monitor|desk)/.test(value)) return 'light'
  if (/(landscap|weld|electri|maintenan|equipment|machine|install|repair)/.test(value)) return 'moderate'
  return null
}

function formatObservationTime(value?: string | null) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function exposureRisk(draft: WorkerDraft, intelligence: SiteIntelligence | null): RiskLevel | null {
  const heatIndex = intelligence?.conditions?.heatIndexC
  if (heatIndex == null) return null

  let score = 0
  if (heatIndex >= 52) score += 5
  else if (heatIndex >= 39) score += 4
  else if (heatIndex >= 32) score += 2
  else if (heatIndex >= 27) score += 1

  if (draft.workIntensity === 'heavy') score += 2
  else if (draft.workIntensity === 'moderate') score += 1

  if (draft.sunExposure === 'direct') score += 2
  else if (draft.sunExposure === 'partial') score += 1
  else if (draft.sunExposure === 'indoor') score -= 1

  if (draft.shadeAccess === 'none') score += 2
  else if (draft.shadeAccess === 'limited') score += 1
  else if (draft.shadeAccess === 'available') score -= 1

  if (draft.waterAccess === false) score += 1

  if (score >= 9) return 'extreme'
  if (score >= 6) return 'high'
  if (score >= 3) return 'medium'
  return 'low'
}

function riskLabel(level: RiskLevel) {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function WorkerMap({
  site,
  coordinate,
  onChange,
  onInvalid,
}: {
  site: Site
  coordinate: Coordinate | null
  onChange: (point: Coordinate) => void
  onInvalid: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const lastValidRef = useRef<Coordinate | null>(coordinate)

  useEffect(() => { lastValidRef.current = coordinate }, [coordinate])

  useEffect(() => {
    if (!apiKey || !container.current) return
    let cancelled = false
    let polygon: google.maps.Polygon | null = null
    let listener: google.maps.MapsEventListener | null = null
    let dragListener: google.maps.MapsEventListener | null = null

    loadGoogleMaps(apiKey).then((g) => {
      if (cancelled || !container.current) return
      const map = new g.maps.Map(container.current, {
        center: site.center,
        zoom: 18,
        mapTypeId: g.maps.MapTypeId.SATELLITE,
        clickableIcons: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: true,
        zoomControl: true,
      })

      polygon = new g.maps.Polygon({
        paths: site.polygon,
        map,
        strokeColor: '#27c0b2',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#0b8b87',
        fillOpacity: 0.22,
        clickable: false,
      })

      const bounds = new g.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 42)

      const marker = new g.maps.Marker({
        position: coordinate ?? site.center,
        map,
        visible: Boolean(coordinate),
        draggable: true,
        title: 'Worker location',
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: '#ef8b27',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      })
      markerRef.current = marker

      const acceptPoint = (point: Coordinate) => {
        if (!pointInsidePolygon(point, site.polygon)) {
          const fallback = lastValidRef.current
          if (fallback) marker.setPosition(fallback)
          else marker.setVisible(false)
          onInvalid()
          return
        }
        marker.setPosition(point)
        marker.setVisible(true)
        lastValidRef.current = point
        onChange(point)
      }

      dragListener = marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) acceptPoint({ lat: event.latLng.lat(), lng: event.latLng.lng() })
      })

      listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        acceptPoint({ lat: event.latLng.lat(), lng: event.latLng.lng() })
      })
    }).catch(() => onInvalid())

    return () => {
      cancelled = true
      listener?.remove()
      dragListener?.remove()
      polygon?.setMap(null)
      markerRef.current?.setMap(null)
      markerRef.current = null
    }
  }, [site.id])

  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    if (!coordinate) {
      marker.setVisible(false)
      return
    }
    marker.setPosition(coordinate)
    marker.setVisible(true)
  }, [coordinate?.lat, coordinate?.lng])

  if (!apiKey) {
    return (
      <div className="worker2-map-missing">
        <MapPin size={28} />
        <strong>Google Maps key required</strong>
        <p>Configure the frontend Maps key before placing a worker.</p>
      </div>
    )
  }

  return <div ref={container} className="worker2-map-canvas" />
}

function SectionTitle({ number, title, detail }: { number: number; title: string; detail: string }) {
  return (
    <div className="worker2-section-title">
      <span>{number}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
  )
}

function Segmented({
  value,
  options,
  onChange,
  danger = false,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  danger?: boolean
}) {
  return (
    <div className={`worker2-segmented${danger ? ' worker2-segmented--danger' : ''}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'is-selected' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function AddWorkerPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? localStorage.getItem(STORAGE_KEY) ?? '')
  const [coordinate, setCoordinate] = useState<Coordinate | null>(null)
  const [draft, setDraft] = useState<WorkerDraft>(() => emptyDraft())
  const [workers, setWorkers] = useState<Worker[]>([])
  const [intelligence, setIntelligence] = useState<SiteIntelligence | null>(null)
  const [loadingSites, setLoadingSites] = useState(true)
  const [loadingContext, setLoadingContext] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)

  const selectedSite = sites.find((site) => site.id === siteId) ?? null
  const recommendedIntensity = useMemo(() => inferWorkIntensity(draft.task), [draft.task])
  const previewReady = Boolean(coordinate && draft.task?.trim())
  const previewRisk = useMemo(
    () => (previewReady ? exposureRisk(draft, intelligence) : null),
    [draft, intelligence, previewReady],
  )
  const previewLabel = !coordinate
    ? 'Awaiting placement'
    : !draft.task?.trim()
      ? 'Add task to assess'
      : !intelligence?.conditions
        ? 'Awaiting verified data'
        : previewRisk
          ? riskLabel(previewRisk)
          : 'Assessment pending'
  const observedLabel = formatObservationTime(intelligence?.observedAt)
  const shiftLabel = draft.shiftStart || draft.shiftEnd
    ? `${draft.shiftStart || '—'} – ${draft.shiftEnd || '—'}`
    : 'Not set'

  useEffect(() => {
    let active = true
    setLoadingSites(true)
    api.listSites()
      .then((loaded) => {
        if (!active) return
        setSites(loaded)
        const requested = searchParams.get('site')
        const stored = localStorage.getItem(STORAGE_KEY)
        const preferred = [requested, siteId, stored].find((id) => id && loaded.some((site) => site.id === id))
        const nextSiteId = preferred ?? loaded[0]?.id ?? ''
        setSiteId(nextSiteId)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load sites.')
      })
      .finally(() => { if (active) setLoadingSites(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!siteId) {
      setWorkers([])
      setIntelligence(null)
      return
    }

    localStorage.setItem(STORAGE_KEY, siteId)
    setSearchParams({ site: siteId }, { replace: true })
    setCoordinate(null)
    setLocationMessage(null)
    setSuccess(null)
    setDraft((current) => ({ ...current, location: 'Site area', locationId: 'site-area' }))

    const controller = new AbortController()
    setLoadingContext(true)
    setIntelligence(null)

    Promise.allSettled([
      api.listWorkers(siteId, controller.signal),
      api.getSiteIntelligence(siteId, controller.signal),
    ]).then(([workerResult, intelligenceResult]) => {
      if (controller.signal.aborted) return
      if (workerResult.status === 'fulfilled') setWorkers(workerResult.value)
      else setError(workerResult.reason instanceof Error ? workerResult.reason.message : 'Could not load workers.')
      if (intelligenceResult.status === 'fulfilled') setIntelligence(intelligenceResult.value)
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingContext(false)
    })

    return () => controller.abort()
  }, [siteId])

  const setField = <K extends keyof WorkerDraft>(key: K, value: WorkerDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setSuccess(null)
  }

  const changeSite = (nextSiteId: string) => {
    setError(null)
    setSiteId(nextSiteId)
  }

  const updateCoordinate = (point: Coordinate) => {
    setCoordinate(point)
    setLocationMessage(null)
    setSuccess(null)
  }

  const canSave = Boolean(
    selectedSite
    && coordinate
    && draft.workerCode?.trim()
    && draft.name.trim()
    && draft.role.trim()
    && draft.team?.trim()
    && draft.task?.trim()
    && !saving,
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedSite || !coordinate || !canSave) return

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const worker = await api.createWorker(selectedSite.id, {
        ...draft,
        workerCode: draft.workerCode?.trim(),
        name: draft.name.trim(),
        role: draft.role.trim(),
        team: draft.team?.trim(),
        task: draft.task?.trim(),
        supervisor: draft.supervisor?.trim(),
        notes: draft.notes?.trim(),
        location: draft.location.trim() || 'Site area',
        locationId: locationId(draft.location),
        coordinate,
      })
      setWorkers((current) => [worker, ...current.filter((item) => item.id !== worker.id)])
      setSuccess(`${worker.name} was added to ${selectedSite.name}.`)
      setDraft(emptyDraft())
      setCoordinate(null)
      setLocationMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add worker.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell>
      <Topbar
        sites={sites}
        selectedSiteId={siteId || null}
        observedAt={intelligence?.observedAt}
        onSiteChange={changeSite}
        pageTitle="Add Worker"
        pageSubtitle="Create a field worker profile, assign the job context and place the worker inside the selected site."
        showAddSite={false}
      />

      <div className="worker2-page">
        {loadingSites && (
          <div className="worker2-state panel"><strong>Loading work sites…</strong><span>Preparing the worker setup workspace.</span></div>
        )}

        {!loadingSites && !sites.length && (
          <div className="worker2-state panel">
            <MapPin size={30} />
            <strong>Create a site before adding workers</strong>
            <span>Every worker belongs to a real work-site boundary.</span>
            <button type="button" className="button button--primary" onClick={() => navigate('/')}>Create Site</button>
          </div>
        )}

        {!loadingSites && selectedSite && (
          <form className="worker2-layout" onSubmit={submit}>
            <section className="worker2-form panel">
              <div className="worker2-form-scroll">
                {success && (
                  <div className="worker2-success"><Check size={18} /><div><strong>Worker saved</strong><span>{success} You can add another worker now.</span></div></div>
                )}

                <section className="worker2-form-section">
                  <SectionTitle number={1} title="Personal Details" detail="Identify the worker and operating team." />
                  <div className="worker2-grid worker2-grid--two">
                    <label><span>Full Name <em>*</em></span><input value={draft.name} onChange={(e) => setField('name', e.target.value)} placeholder="Worker full name" autoFocus /></label>
                    <label><span>Worker ID <em>*</em></span><input value={draft.workerCode ?? ''} onChange={(e) => setField('workerCode', e.target.value)} placeholder="WKR-1047" /></label>
                    <label><span>Role <em>*</em></span><input value={draft.role} onChange={(e) => setField('role', e.target.value)} placeholder="e.g. Roofer" list="heatshield-roles" /></label>
                    <label><span>Team <em>*</em></span><input value={draft.team ?? ''} onChange={(e) => setField('team', e.target.value)} placeholder="e.g. Roof Crew" /></label>
                  </div>
                  <datalist id="heatshield-roles"><option value="Roofer" /><option value="Laborer" /><option value="Electrician" /><option value="Foreman" /><option value="Equipment Operator" /><option value="Inspector" /></datalist>
                </section>

                <section className="worker2-form-section">
                  <SectionTitle number={2} title="Work Assignment" detail="Describe today's task, workload, work area and shift." />
                  <div className="worker2-grid worker2-grid--two">
                    <label className="worker2-span-two"><span>Current Task <em>*</em></span><input value={draft.task ?? ''} onChange={(e) => setField('task', e.target.value)} placeholder="e.g. Roofing, loading, inspection" list="heatshield-tasks" /></label>
                    <datalist id="heatshield-tasks">{TASK_OPTIONS.map((task) => <option key={task} value={task} />)}</datalist>
                    <label className="worker2-span-two"><span>Work Area / Zone</span><input value={draft.location} onChange={(e) => setField('location', e.target.value)} placeholder="e.g. Roof Area" list="heatshield-zones" /></label>
                    <datalist id="heatshield-zones">{selectedSite.zones.map((zone) => <option key={zone.id} value={zone.name} />)}</datalist>
                    <div className="worker2-field worker2-span-two">
                      <span>Work Intensity</span>
                      <Segmented value={draft.workIntensity ?? 'moderate'} options={[{ value: 'light', label: 'Low' }, { value: 'moderate', label: 'Moderate' }, { value: 'heavy', label: 'High' }]} onChange={(value) => setField('workIntensity', value as WorkerDraft['workIntensity'])} danger />
                      <div className="worker2-intensity-scale"><span><strong>Low</strong> light movement</span><span><strong>Moderate</strong> continuous physical work</span><span><strong>High</strong> strenuous / heavy work</span></div>
                      {recommendedIntensity && recommendedIntensity !== draft.workIntensity && (
                        <div className="worker2-suggestion">
                          <span>Task-based suggestion: <strong>{intensityLabel(recommendedIntensity)}</strong></span>
                          <button type="button" onClick={() => setField('workIntensity', recommendedIntensity)}>Apply</button>
                        </div>
                      )}
                    </div>
                    <label><span>Shift Start</span><input type="time" value={draft.shiftStart ?? ''} onChange={(e) => setField('shiftStart', e.target.value)} /></label>
                    <label><span>Shift End</span><input type="time" value={draft.shiftEnd ?? ''} onChange={(e) => setField('shiftEnd', e.target.value)} /></label>
                  </div>
                </section>

                <section className="worker2-form-section">
                  <SectionTitle number={3} title="Exposure Context" detail="Capture field controls that modify the worker's exposure." />
                  <div className="worker2-context-note"><ShieldCheck size={16} /><div><strong>Field inputs</strong><span>HeatShield combines these supervisor-entered controls with the verified FortyGuard observation. They are not provider measurements.</span></div></div>
                  <div className="worker2-grid worker2-grid--one">
                    <div className="worker2-field"><span>Sun Exposure</span><Segmented value={draft.sunExposure ?? 'direct'} options={[{ value: 'indoor', label: 'Indoor' }, { value: 'partial', label: 'Partial' }, { value: 'direct', label: 'Direct' }]} onChange={(value) => setField('sunExposure', value as WorkerDraft['sunExposure'])} danger /></div>
                    <div className="worker2-field"><span>Shade Access</span><Segmented value={draft.shadeAccess ?? 'limited'} options={[{ value: 'available', label: 'Good' }, { value: 'limited', label: 'Limited' }, { value: 'none', label: 'None' }]} onChange={(value) => setField('shadeAccess', value as WorkerDraft['shadeAccess'])} danger /></div>
                    <div className="worker2-field"><span>Water Access</span><Segmented value={draft.waterAccess ? 'yes' : 'no'} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} onChange={(value) => setField('waterAccess', value === 'yes')} /></div>
                  </div>
                </section>

                <section className="worker2-form-section worker2-form-section--last">
                  <SectionTitle number={4} title="Operational Details" detail="Supervisor, status and field notes." />
                  <div className="worker2-grid worker2-grid--two">
                    <label><span>Supervisor</span><input value={draft.supervisor ?? ''} onChange={(e) => setField('supervisor', e.target.value)} placeholder="Supervisor name" /></label>
                    <label><span>Status</span><select value={draft.status ?? 'active'} onChange={(e) => setField('status', e.target.value as WorkerStatus)}><option value="active">Active</option><option value="break">On break</option><option value="offsite">Off site</option></select></label>
                    <label className="worker2-span-two"><span>Notes</span><textarea maxLength={500} value={draft.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} placeholder="Operational notes, restrictions, or instructions…" /><small className="worker2-count">{draft.notes?.length ?? 0} / 500</small></label>
                  </div>
                </section>
              </div>

              {error && <div className="worker2-error">{error}</div>}
              <div className="worker2-form-actions">
                <div className="worker2-save-status">
                  {coordinate ? <><ShieldCheck size={17} /><span>Worker location confirmed inside {selectedSite.name}</span></> : <><MapPin size={17} /><span>Place worker on map before saving</span></>}
                </div>
                <button type="button" className="button button--secondary" onClick={() => navigate(`/?site=${selectedSite.id}`)}>Cancel</button>
                <button type="submit" className="button button--primary worker2-save" disabled={!canSave}><Check size={17} /> {saving ? 'Saving…' : 'Save Worker'}</button>
              </div>
            </section>

            <div className="worker2-right">
              <section className="worker2-map-card panel">
                <div className="worker2-map-header">
                  <div>
                    <span>Selected Site</span>
                    <strong>{selectedSite.name}</strong>
                    <small>{selectedSite.address || `${selectedSite.center.lat.toFixed(5)}, ${selectedSite.center.lng.toFixed(5)}`}</small>
                    <small className="worker2-map-site-meta">Center {selectedSite.center.lat.toFixed(5)}, {selectedSite.center.lng.toFixed(5)} · {selectedSite.polygon.length} boundary points</small>
                  </div>
                  <div className="worker2-map-header__action"><MapPin size={17} /> Click inside boundary to place</div>
                </div>
                <div className="worker2-map-wrap">
                  <WorkerMap site={selectedSite} coordinate={coordinate} onChange={updateCoordinate} onInvalid={() => setLocationMessage('Worker must be placed inside the selected site boundary.')} />
                  <div className={`worker2-location-card${coordinate ? ' is-ready' : ''}`}>
                    <div className="worker2-location-card__title"><span><UserRound size={16} /></span><div><strong>Worker Location</strong><small>{coordinate ? 'Placement confirmed' : 'Click map to place'}</small></div></div>
                    <div className="worker2-location-row"><span>Lat / Lng</span><strong>{coordinate ? `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}` : 'Not placed'}</strong></div>
                    <div className="worker2-location-row"><span>Work area</span><strong>{draft.location || 'Site area'}</strong></div>
                    <div className="worker2-location-row"><span>Boundary</span><strong>{coordinate ? 'Inside selected site' : 'Placement required'}</strong></div>
                  </div>
                  {locationMessage && <div className="worker2-map-alert">{locationMessage}</div>}
                </div>
              </section>

              <section className="worker2-exposure panel">
                <div className="worker2-card-heading">
                  <div><span className="eyebrow">FORTYGUARD + WORKER CONTEXT</span><h2>Exposure screening preview</h2></div>
                  <span className={`worker2-risk worker2-risk--${previewRisk ?? 'pending'}`}>{previewLabel}</span>
                </div>

                <div className="worker2-observation-grid">
                  <div className="worker2-exposure-primary">
                    {intelligence?.conditions ? (
                      <>
                        <ThermometerSun size={30} />
                        <div><strong>{intelligence.conditions.temperatureC.toFixed(1)}°C</strong><span>FortyGuard site temperature</span></div>
                      </>
                    ) : (
                      <>
                        <ThermometerSun size={30} />
                        <div><strong>—</strong><span>{loadingContext ? 'Checking verified conditions…' : 'No verified observation'}</span></div>
                      </>
                    )}
                  </div>
                  <div className="worker2-exposure-stat"><span>Heat Index</span><strong>{intelligence?.conditions ? `${intelligence.conditions.heatIndexC.toFixed(1)}°C` : '—'}</strong></div>
                  <div className="worker2-exposure-stat"><span>Feels Like</span><strong>{intelligence?.conditions ? `${intelligence.conditions.feelsLikeC.toFixed(1)}°C` : '—'}</strong></div>
                  <div className="worker2-exposure-stat"><span>Humidity</span><strong>{intelligence?.conditions ? `${intelligence.conditions.humidityPercent.toFixed(0)}%` : '—'}</strong></div>
                </div>

                <div className="worker2-context-grid">
                  <div><Sun size={18} /><span>Sun</span><strong>{draft.sunExposure === 'direct' ? 'Direct' : draft.sunExposure === 'partial' ? 'Partial' : 'Indoor'}</strong></div>
                  <div><ShieldCheck size={18} /><span>Shade</span><strong>{draft.shadeAccess === 'available' ? 'Good' : draft.shadeAccess === 'none' ? 'None' : 'Limited'}</strong></div>
                  <div><Droplets size={18} /><span>Water</span><strong>{draft.waterAccess ? 'Available' : 'No access'}</strong></div>
                  <div><ClipboardCheck size={18} /><span>Workload</span><strong>{intensityLabel(draft.workIntensity)}</strong></div>
                </div>

                <div className="worker2-source-strip">
                  <div><span>Observation time</span><strong>{observedLabel}</strong></div>
                  <div><span>Provider status</span><strong>{intelligence?.conditions ? (intelligence.conditions.weatherLabel || 'FortyGuard verified') : 'Unavailable'}</strong></div>
                  <div><span>Worker shift</span><strong>{shiftLabel}</strong></div>
                </div>

                <div className={`worker2-assessment-note${previewRisk ? ' is-ready' : ''}`}>
                  <ClipboardCheck size={17} />
                  <div>
                    <strong>{previewLabel}</strong>
                    <span>
                      {!coordinate
                        ? 'Place the worker inside the site boundary before HeatShield calculates a worker-specific screening level.'
                        : !draft.task?.trim()
                          ? 'Add the current task so the screening has a real work context.'
                          : !intelligence?.conditions
                            ? (intelligence?.statusMessage || 'HeatShield is waiting for a verified FortyGuard observation for this site.')
                            : 'HeatShield combines the verified FortyGuard heat index with workload, sun exposure, shade and water access. This is an operational screening signal, not a medical diagnosis.'}
                    </span>
                  </div>
                </div>
              </section>

              <section className="worker2-recent panel">
                <div className="worker2-card-heading worker2-card-heading--table">
                  <div><span className="eyebrow">SELECTED SITE</span><h2>Recently Added Workers</h2></div>
                  <span>{workers.length} total</span>
                </div>
                {workers.length ? (
                  <div className="worker2-table-wrap">
                    <table className="worker2-table">
                      <thead><tr><th>Worker</th><th>Role</th><th>Team</th><th>Task</th><th>Location</th><th>Status</th><th>Check-in</th></tr></thead>
                      <tbody>
                        {workers.slice(0, 4).map((worker) => (
                          <tr key={worker.id}>
                            <td><span className="worker2-avatar">{worker.initials}</span><span><strong>{worker.name}</strong><small>{worker.workerCode ?? worker.id}</small></span></td>
                            <td>{worker.role}</td>
                            <td>{worker.team ?? '—'}</td>
                            <td>{worker.task ?? '—'}</td>
                            <td><span className="worker2-location-dot" />{worker.location}</td>
                            <td><span className={`worker2-status worker2-status--${worker.status}`}>{displayStatus(worker.status)}</span></td>
                            <td><Clock3 size={13} /> {worker.lastCheckIn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="worker2-recent-empty"><UsersRound size={24} /><div><strong>No workers at this site yet</strong><span>The first saved worker will appear here immediately.</span></div></div>
                )}
              </section>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  )
}
