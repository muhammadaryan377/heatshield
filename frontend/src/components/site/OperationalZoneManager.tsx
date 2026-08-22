import { Check, MapPin, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Coordinate, Site, Worker } from '../../types/site'

interface Props {
  site: Site
  workers: Worker[]
  onSiteUpdated: (site: Site) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function pointOnSegment(point: Coordinate, a: Coordinate, b: Coordinate) {
  const epsilon = 1e-9
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
  let j = polygon.length - 1
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    const intersects = (current.lat > point.lat) !== (previous.lat > point.lat)
      && point.lng < ((previous.lng - current.lng) * (point.lat - current.lat)) / (previous.lat - current.lat) + current.lng
    if (intersects) inside = !inside
    j = i
  }
  return inside
}

export function OperationalZoneManager({ site, workers, onSiteUpdated }: Props) {
  const mapNode = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const draftMarkerRef = useRef<google.maps.Marker | null>(null)
  const zoneMarkersRef = useRef<google.maps.Marker[]>([])
  const [point, setPoint] = useState<Coordinate | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<'open-yard' | 'roof' | 'staging' | 'other'>('staging')
  const [allTasks, setAllTasks] = useState(false)
  const [tasks, setTasks] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workerTasks = useMemo(() => {
    const values = workers.map((worker) => (worker.task || worker.role).trim()).filter(Boolean)
    return [...new Set(values)].sort((a, b) => a.localeCompare(b))
  }, [workers])

  useEffect(() => {
    setPoint(null)
    setName('')
    setTasks([])
    setAllTasks(false)
    setError(null)
  }, [site.id])

  useEffect(() => {
    if (!apiKey || !mapNode.current) return
    let cancelled = false
    let boundary: google.maps.Polygon | null = null
    let clickListener: google.maps.MapsEventListener | null = null

    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !mapNode.current) return
      const map = new googleInstance.maps.Map(mapNode.current, {
        center: site.center,
        zoom: 17,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        draggableCursor: 'crosshair',
      })
      mapRef.current = map
      boundary = new googleInstance.maps.Polygon({
        map,
        paths: site.polygon,
        strokeColor: '#2bc5ba',
        strokeWeight: 3,
        strokeOpacity: 1,
        fillColor: '#0b8b87',
        fillOpacity: 0.16,
        clickable: false,
      })
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((item) => bounds.extend(item))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 46)

      zoneMarkersRef.current.forEach((marker) => marker.setMap(null))
      zoneMarkersRef.current = site.zones.map((zone) => new googleInstance.maps.Marker({
        map,
        position: zone.center,
        title: `${zone.name} — approved operational zone`,
        label: { text: zone.name.slice(0, 1).toUpperCase(), color: '#ffffff', fontWeight: '700' },
        icon: {
          path: googleInstance.maps.SymbolPath.CIRCLE,
          fillColor: zone.operationalApproved ? '#078d86' : '#778486',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 13,
        },
      }))

      clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        if (!pointInPolygon(next, site.polygon)) {
          setError('Operational zone must be placed inside the saved site boundary.')
          return
        }
        setError(null)
        setPoint(next)
      })
    }).catch((err: Error) => setError(err.message))

    return () => {
      cancelled = true
      clickListener?.remove()
      boundary?.setMap(null)
      draftMarkerRef.current?.setMap(null)
      zoneMarkersRef.current.forEach((marker) => marker.setMap(null))
      zoneMarkersRef.current = []
      mapRef.current = null
    }
  }, [site.id, site.center.lat, site.center.lng, site.polygon, site.zones])

  useEffect(() => {
    draftMarkerRef.current?.setMap(null)
    if (!point || !mapRef.current || !window.google?.maps) return
    draftMarkerRef.current = new google.maps.Marker({
      map: mapRef.current,
      position: point,
      title: 'New operational zone',
      zIndex: 50,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: '#ff8a24',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3,
        scale: 12,
      },
    })
    return () => draftMarkerRef.current?.setMap(null)
  }, [point])

  const toggleTask = (task: string) => {
    setTasks((current) => current.includes(task) ? current.filter((item) => item !== task) : [...current, task])
  }

  const save = async () => {
    if (!point) { setError('Click the site map to place the approved zone.'); return }
    if (name.trim().length < 2) { setError('Give the operational zone a clear name.'); return }
    if (!allTasks && !tasks.length) { setError('Select at least one task or allow all tasks.'); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await api.addSiteZone(site.id, {
        name: name.trim(),
        type,
        center: point,
        allowedTasks: allTasks ? ['*'] : tasks,
        operationalApproved: true,
      })
      onSiteUpdated(updated)
      setPoint(null)
      setName('')
      setTasks([])
      setAllTasks(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the operational zone.')
    } finally {
      setSaving(false)
    }
  }

  const removeZone = async (zoneId: string) => {
    setError(null)
    try {
      const updated = await api.deleteSiteZone(site.id, zoneId)
      onSiteUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the operational zone.')
    }
  }

  return (
    <section className="zone-manager panel">
      <div className="zone-manager__heading">
        <div><span className="sites-eyebrow">SUPERVISOR-APPROVED MOVEMENT</span><h2>Operational Zones</h2><p>Only zones configured here can be considered by BETTER PLACE. Click inside the site boundary to place a zone.</p></div>
        <span className="zone-manager__count"><ShieldCheck size={16} /> {site.zones.filter((zone) => zone.operationalApproved).length} approved</span>
      </div>

      <div className="zone-manager__layout">
        <div className="zone-manager__map-wrap">
          {apiKey ? <div ref={mapNode} className="zone-manager__map" /> : <div className="zone-manager__map-empty"><MapPin size={24} /><strong>Google Maps key required</strong><span>Configure the browser map key to place approved zones.</span></div>}
          {point && <div className="zone-manager__coordinate">Selected: {point.lat.toFixed(5)}, {point.lng.toFixed(5)}</div>}
        </div>

        <div className="zone-manager__form">
          <label><span>Zone name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Covered Staging" /></label>
          <label><span>Zone type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="staging">Staging</option><option value="open-yard">Open yard</option><option value="roof">Roof</option><option value="other">Other</option></select></label>

          <div className="zone-manager__task-section">
            <div className="zone-manager__task-title"><span>Approved tasks</span><button type="button" className={allTasks ? 'active' : ''} onClick={() => { setAllTasks((value) => !value); setTasks([]) }}><Check size={14} /> All tasks</button></div>
            {!allTasks && <div className="zone-manager__tasks">{workerTasks.length ? workerTasks.map((task) => <button type="button" key={task} className={tasks.includes(task) ? 'active' : ''} onClick={() => toggleTask(task)}>{task}</button>) : <small>Add workers/tasks first, or choose “All tasks”.</small>}</div>}
          </div>

          <button type="button" className="button button--primary" onClick={() => void save()} disabled={saving || !apiKey}><Plus size={16} /> {saving ? 'Saving zone…' : 'Add Approved Zone'}</button>
          {error && <div className="form-error">{error}</div>}
        </div>
      </div>

      <div className="zone-manager__list">
        {site.zones.length ? site.zones.map((zone) => <article key={zone.id}>
          <span className="zone-manager__pin"><MapPin size={16} /></span>
          <div><strong>{zone.name}</strong><small>{zone.type.replace('-', ' ')} · {zone.allowedTasks.includes('*') ? 'All tasks' : zone.allowedTasks.join(', ') || 'No tasks approved'}</small></div>
          <span className="status-pill status-pill--active">Approved</span>
          <button type="button" onClick={() => void removeZone(zone.id)} aria-label={`Remove ${zone.name}`}><Trash2 size={16} /></button>
        </article>) : <div className="zone-manager__empty"><ShieldCheck size={18} /><span>No approved zones yet. BETTER PLACE will stay disabled until the supervisor adds one.</span></div>}
      </div>
    </section>
  )
}
