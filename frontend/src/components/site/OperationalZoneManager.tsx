import { Check, Edit3, MapPin, Plus, RotateCcw, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import { siteManagementApi } from '../../lib/siteManagementApi'
import type { Coordinate, Site, SiteZone, SiteZoneCreate, Worker } from '../../types/site'

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
  return point.lng >= Math.min(a.lng, b.lng) - epsilon && point.lng <= Math.max(a.lng, b.lng) + epsilon
    && point.lat >= Math.min(a.lat, b.lat) - epsilon && point.lat <= Math.max(a.lat, b.lat) + epsilon
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

function centerOf(points: Coordinate[]): Coordinate {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function zoneColor(type: SiteZone['type']) {
  if (type === 'recovery') return '#1a9d66'
  if (type === 'restricted') return '#d84b45'
  if (type === 'roof') return '#8b65c4'
  if (type === 'staging') return '#327bbb'
  if (type === 'open-yard') return '#0b8b87'
  return '#6c7f84'
}

export function OperationalZoneManager({ site, workers, onSiteUpdated }: Props) {
  const mapNode = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const staticOverlaysRef = useRef<Array<google.maps.Polygon | google.maps.Marker>>([])
  const draftPolygonRef = useRef<google.maps.Polygon | null>(null)
  const draftMarkersRef = useRef<google.maps.Marker[]>([])
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [points, setPoints] = useState<Coordinate[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState<SiteZone['type']>('staging')
  const [allTasks, setAllTasks] = useState(false)
  const [tasks, setTasks] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workerTasks = useMemo(() => [...new Set(workers.map((worker) => (worker.task || worker.role).trim()).filter(Boolean))].sort(), [workers])
  const ready = points.length >= 3 && name.trim().length >= 2 && (allTasks || tasks.length > 0 || type === 'restricted')

  const resetDraft = () => {
    setPoints([])
    setName('')
    setType('staging')
    setAllTasks(false)
    setTasks([])
    setEditingId(null)
    setError(null)
  }

  useEffect(() => resetDraft(), [site.id])

  useEffect(() => {
    if (!apiKey || !mapNode.current) return
    let cancelled = false
    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !mapNode.current) return
      const map = new googleInstance.maps.Map(mapNode.current, {
        center: site.center,
        zoom: 17,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        draggableCursor: 'crosshair',
      })
      mapRef.current = map
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((item) => bounds.extend(item))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 48)
      listenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        if (!pointInPolygon(next, site.polygon)) {
          setError('Every zone corner must stay inside the saved site boundary.')
          return
        }
        setError(null)
        setPoints((current) => current.length >= 60 ? current : [...current, next])
      })
      setMapReady(true)
    }).catch((err: Error) => setError(err.message))
    return () => {
      cancelled = true
      listenerRef.current?.remove()
      listenerRef.current = null
      staticOverlaysRef.current.forEach((item) => item.setMap(null))
      staticOverlaysRef.current = []
      draftPolygonRef.current?.setMap(null)
      draftMarkersRef.current.forEach((marker) => marker.setMap(null))
      draftMarkersRef.current = []
      setMapReady(false)
      mapRef.current = null
    }
  }, [site.id, site.center.lat, site.center.lng, site.polygon])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return
    staticOverlaysRef.current.forEach((item) => item.setMap(null))
    staticOverlaysRef.current = []
    const boundary = new google.maps.Polygon({
      map: mapRef.current,
      paths: site.polygon,
      strokeColor: '#2bc5ba',
      strokeWeight: 3,
      strokeOpacity: 1,
      fillColor: '#0b8b87',
      fillOpacity: .08,
      clickable: false,
      zIndex: 1,
    })
    staticOverlaysRef.current.push(boundary)
    site.zones.forEach((zone) => {
      if (zone.id === editingId) return
      if (zone.polygon?.length >= 3) {
        const color = zoneColor(zone.type)
        const polygon = new google.maps.Polygon({
          map: mapRef.current,
          paths: zone.polygon,
          strokeColor: color,
          strokeWeight: 2,
          strokeOpacity: 1,
          fillColor: color,
          fillOpacity: zone.type === 'restricted' ? .2 : .13,
          zIndex: 2,
        })
        staticOverlaysRef.current.push(polygon)
      } else {
        const marker = new google.maps.Marker({
          map: mapRef.current,
          position: zone.center,
          title: `${zone.name} · legacy point zone`,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: '#7b8588', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 9 },
        })
        staticOverlaysRef.current.push(marker)
      }
    })
  }, [editingId, mapReady, site.polygon, site.zones])

  useEffect(() => {
    draftPolygonRef.current?.setMap(null)
    draftMarkersRef.current.forEach((marker) => marker.setMap(null))
    draftPolygonRef.current = null
    draftMarkersRef.current = []
    if (!mapRef.current || !window.google?.maps || !points.length) return
    const color = zoneColor(type)
    draftMarkersRef.current = points.map((point, index) => new google.maps.Marker({
      map: mapRef.current,
      position: point,
      zIndex: 20,
      title: `Zone corner ${index + 1}`,
      label: { text: String(index + 1), color: '#fff', fontSize: '10px', fontWeight: '700' },
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 8 },
    }))
    if (points.length >= 2) {
      draftPolygonRef.current = new google.maps.Polygon({
        map: mapRef.current,
        paths: points,
        strokeColor: color,
        strokeWeight: 3,
        strokeOpacity: 1,
        fillColor: color,
        fillOpacity: points.length >= 3 ? .22 : 0,
        clickable: false,
        zIndex: 10,
      })
    }
  }, [points, type])

  const toggleTask = (task: string) => setTasks((current) => current.includes(task) ? current.filter((item) => item !== task) : [...current, task])

  const editZone = (zone: SiteZone) => {
    if (!zone.polygon?.length) {
      setError('This is a legacy point zone. Delete it and redraw it as a polygon.')
      return
    }
    setEditingId(zone.id)
    setName(zone.name)
    setType(zone.type)
    setPoints(zone.polygon)
    setAllTasks(zone.allowedTasks.includes('*'))
    setTasks(zone.allowedTasks.includes('*') ? [] : zone.allowedTasks)
    setError(null)
  }

  const save = async () => {
    if (points.length < 3) { setError('Click at least 3 corners to draw the operational-zone area.'); return }
    if (name.trim().length < 2) { setError('Give the zone a clear name.'); return }
    if (!allTasks && !tasks.length && type !== 'restricted') { setError('Choose approved tasks, or select All tasks.'); return }
    const payload: SiteZoneCreate = {
      name: name.trim(),
      type,
      center: centerOf(points),
      polygon: points,
      allowedTasks: type === 'restricted' ? [] : allTasks ? ['*'] : tasks,
      operationalApproved: type !== 'restricted',
    }
    setSaving(true)
    setError(null)
    try {
      const updated = editingId
        ? await siteManagementApi.updateZone(site.id, editingId, payload)
        : await api.addSiteZone(site.id, payload)
      onSiteUpdated(updated)
      resetDraft()
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
      if (editingId === zoneId) resetDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the operational zone.')
    }
  }

  return <section className="zone-manager zone-manager--polygon panel">
    <div className="zone-manager__heading">
      <div><span className="sites-eyebrow">SUPERVISOR-DEFINED AREAS</span><h2>Operational Zone Designer</h2><p>Draw real zone polygons, not single points. Every click becomes a numbered corner inside the site boundary.</p></div>
      <span className="zone-manager__count"><ShieldCheck size={16}/> {site.zones.filter((zone) => zone.operationalApproved).length} approved</span>
    </div>

    <div className="zone-manager__layout zone-manager__layout--polygon">
      <div className="zone-manager__map-wrap">
        {apiKey ? <div ref={mapNode} className="zone-manager__map zone-manager__map--large"/> : <div className="zone-manager__map-empty"><MapPin size={24}/><strong>Google Maps key required</strong><span>Configure the browser map key to draw zones.</span></div>}
        <div className="zone-draw-toolbar">
          <span>{points.length} corner{points.length === 1 ? '' : 's'} selected</span>
          <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length}><Undo2 size={14}/> Undo</button>
          <button type="button" onClick={() => setPoints([])} disabled={!points.length}><RotateCcw size={14}/> Clear</button>
        </div>
      </div>

      <div className="zone-manager__form">
        <div className="zone-form-mode"><strong>{editingId ? 'Editing zone' : 'New polygon zone'}</strong><span>{points.length >= 3 ? 'Area ready' : `Select ${Math.max(0, 3 - points.length)} more corner${3 - points.length === 1 ? '' : 's'}`}</span></div>
        <label><span>Zone name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Covered Recovery Area"/></label>
        <label><span>Zone type</span><select value={type} onChange={(event) => setType(event.target.value as SiteZone['type'])}><option value="recovery">Recovery / cooling</option><option value="staging">Staging</option><option value="open-yard">Open yard</option><option value="roof">Roof</option><option value="restricted">Restricted / no-go</option><option value="other">Other</option></select></label>

        {type !== 'restricted' && <div className="zone-manager__task-section">
          <div className="zone-manager__task-title"><span>Approved tasks</span><button type="button" className={allTasks ? 'active' : ''} onClick={() => { setAllTasks((value) => !value); setTasks([]) }}><Check size={14}/> All tasks</button></div>
          {!allTasks && <div className="zone-manager__tasks">{workerTasks.length ? workerTasks.map((task) => <button type="button" key={task} className={tasks.includes(task) ? 'active' : ''} onClick={() => toggleTask(task)}>{task}</button>) : <small>No worker tasks yet. Use All tasks for a general approved area.</small>}</div>}
        </div>}

        <button type="button" className="button button--primary" onClick={() => void save()} disabled={saving || !apiKey || !ready}><Plus size={16}/> {saving ? 'Saving zone…' : editingId ? 'Update Polygon Zone' : 'Add Polygon Zone'}</button>
        {editingId && <button type="button" className="button button--secondary" onClick={resetDraft}>Cancel edit</button>}
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>

    <div className="zone-manager__list">
      {site.zones.length ? site.zones.map((zone) => <article key={zone.id}>
        <span className="zone-manager__pin" style={{ color: zoneColor(zone.type) }}><MapPin size={16}/></span>
        <div><strong>{zone.name}</strong><small>{zone.type.replace('-', ' ')} · {zone.polygon?.length >= 3 ? `${zone.polygon.length} corner polygon` : 'legacy point zone'} · {zone.allowedTasks.includes('*') ? 'all tasks' : zone.allowedTasks.join(', ') || 'no tasks'}</small></div>
        <span className={`status-pill ${zone.operationalApproved ? 'status-pill--active' : 'status-pill--offsite'}`}>{zone.operationalApproved ? 'Approved' : 'Restricted'}</span>
        <button type="button" onClick={() => editZone(zone)} aria-label={`Edit ${zone.name}`}><Edit3 size={16}/></button>
        <button type="button" onClick={() => void removeZone(zone.id)} aria-label={`Remove ${zone.name}`}><Trash2 size={16}/></button>
      </article>) : <div className="zone-manager__empty"><ShieldCheck size={18}/><span>No operational zones yet. Draw a recovery, work, staging or restricted area on the map.</span></div>}
    </div>
  </section>
}
