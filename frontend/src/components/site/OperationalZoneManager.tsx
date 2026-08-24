import { Check, MapPin, Plus, ShieldCheck, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Coordinate, Site, SiteZone, Worker } from '../../types/site'

interface Props {
  site: Site
  workers: Worker[]
  onSiteUpdated: (site: Site) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const AREA_META_PREFIX = '__hs_zone_area__:'
const AREA_CHUNK_SIZE = 3
const MAX_AREA_POINTS = 24

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

function polygonCenter(points: Coordinate[]): Coordinate {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function encodeArea(points: Coordinate[]) {
  const encoded: string[] = []
  for (let index = 0; index < points.length; index += AREA_CHUNK_SIZE) {
    const chunk = points
      .slice(index, index + AREA_CHUNK_SIZE)
      .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
      .join('|')
    encoded.push(`${AREA_META_PREFIX}${chunk}`)
  }
  return encoded
}

function decodeArea(zone: SiteZone): Coordinate[] {
  return zone.allowedTasks
    .filter((item) => item.startsWith(AREA_META_PREFIX))
    .flatMap((item) => item.slice(AREA_META_PREFIX.length).split('|'))
    .map((pair) => {
      const [latText, lngText] = pair.split(',')
      return { lat: Number(latText), lng: Number(lngText) }
    })
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
}

function visibleTasks(zone: SiteZone) {
  return zone.allowedTasks.filter((item) => !item.startsWith(AREA_META_PREFIX))
}

export function OperationalZoneManager({ site, workers, onSiteUpdated }: Props) {
  const mapNode = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const draftPolygonRef = useRef<google.maps.Polygon | null>(null)
  const draftVertexMarkersRef = useRef<google.maps.Marker[]>([])
  const zoneMarkersRef = useRef<google.maps.Marker[]>([])
  const zonePolygonsRef = useRef<google.maps.Polygon[]>([])
  const [area, setArea] = useState<Coordinate[]>([])
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
    setArea([])
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
        fillOpacity: 0.08,
        clickable: false,
      })
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((item) => bounds.extend(item))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 46)

      zoneMarkersRef.current.forEach((marker) => marker.setMap(null))
      zonePolygonsRef.current.forEach((polygon) => polygon.setMap(null))
      zoneMarkersRef.current = []
      zonePolygonsRef.current = []

      site.zones.forEach((zone) => {
        const zoneArea = decodeArea(zone)
        if (zoneArea.length >= 3) {
          zonePolygonsRef.current.push(new googleInstance.maps.Polygon({
            map,
            paths: zoneArea,
            strokeColor: zone.operationalApproved ? '#08a39b' : '#778486',
            strokeWeight: 3,
            strokeOpacity: 1,
            fillColor: zone.operationalApproved ? '#0b8b87' : '#778486',
            fillOpacity: 0.28,
            clickable: false,
            zIndex: 18,
          }))
        }

        zoneMarkersRef.current.push(new googleInstance.maps.Marker({
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
            scale: zoneArea.length >= 3 ? 10 : 13,
          },
          zIndex: 25,
        }))
      })

      clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        if (!pointInPolygon(next, site.polygon)) {
          setError('Every approved-zone boundary point must stay inside the saved site boundary.')
          return
        }
        setArea((current) => {
          if (current.length >= MAX_AREA_POINTS) {
            setError(`An operational zone can contain up to ${MAX_AREA_POINTS} boundary points.`)
            return current
          }
          setError(null)
          return [...current, next]
        })
      })
    }).catch((err: Error) => setError(err.message))

    return () => {
      cancelled = true
      clickListener?.remove()
      boundary?.setMap(null)
      draftPolygonRef.current?.setMap(null)
      draftVertexMarkersRef.current.forEach((marker) => marker.setMap(null))
      draftVertexMarkersRef.current = []
      zoneMarkersRef.current.forEach((marker) => marker.setMap(null))
      zoneMarkersRef.current = []
      zonePolygonsRef.current.forEach((polygon) => polygon.setMap(null))
      zonePolygonsRef.current = []
      mapRef.current = null
    }
  }, [site.id, site.center.lat, site.center.lng, site.polygon, site.zones])

  useEffect(() => {
    draftPolygonRef.current?.setMap(null)
    draftPolygonRef.current = null
    draftVertexMarkersRef.current.forEach((marker) => marker.setMap(null))
    draftVertexMarkersRef.current = []
    if (!area.length || !mapRef.current || !window.google?.maps) return

    draftPolygonRef.current = new google.maps.Polygon({
      map: mapRef.current,
      paths: area,
      strokeColor: '#ff9b23',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#ff9b23',
      fillOpacity: area.length >= 3 ? 0.3 : 0,
      clickable: false,
      zIndex: 40,
    })

    draftVertexMarkersRef.current = area.map((point, index) => new google.maps.Marker({
      map: mapRef.current,
      position: point,
      title: `Zone boundary point ${index + 1}`,
      label: { text: String(index + 1), color: '#ffffff', fontSize: '9px', fontWeight: '800' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: index === 0 ? '#0b8b87' : '#ff8a24',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 8,
      },
      zIndex: 50,
    }))

    return () => {
      draftPolygonRef.current?.setMap(null)
      draftVertexMarkersRef.current.forEach((marker) => marker.setMap(null))
      draftVertexMarkersRef.current = []
    }
  }, [area])

  const toggleTask = (task: string) => {
    setTasks((current) => current.includes(task) ? current.filter((item) => item !== task) : [...current, task])
  }

  const save = async () => {
    if (area.length < 3) { setError('Select the zone area with at least 3 boundary points on the map.'); return }
    if (name.trim().length < 2) { setError('Give the operational zone a clear name.'); return }
    if (!allTasks && !tasks.length) { setError('Select at least one task or allow all tasks.'); return }

    const allowedTasks = [...(allTasks ? ['*'] : tasks), ...encodeArea(area)]
    if (allowedTasks.length > 30) {
      setError('This zone has too many task and boundary entries. Reduce the number of map points or approved tasks.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const updated = await api.addSiteZone(site.id, {
        name: name.trim(),
        type,
        center: polygonCenter(area),
        allowedTasks,
        operationalApproved: true,
      })
      onSiteUpdated(updated)
      setArea([])
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
        <div><span className="sites-eyebrow">SUPERVISOR-APPROVED MOVEMENT</span><h2>Operational Zones</h2><p>Draw the exact approved area: click 3 or more points around the zone inside the site boundary. HeatShield closes and saves the area automatically.</p></div>
        <span className="zone-manager__count"><ShieldCheck size={16} /> {site.zones.filter((zone) => zone.operationalApproved).length} approved</span>
      </div>

      <div className="zone-manager__layout">
        <div className="zone-manager__map-wrap">
          {apiKey ? <div ref={mapNode} className="zone-manager__map" /> : <div className="zone-manager__map-empty"><MapPin size={24} /><strong>Google Maps key required</strong><span>Configure the browser map key to draw approved zones.</span></div>}
          {area.length > 0 && <div className="zone-manager__coordinate">Area boundary: {area.length} point{area.length === 1 ? '' : 's'} · {area.length >= 3 ? 'ready to save' : `${3 - area.length} more needed`}</div>}
          {area.length > 0 && (
            <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 5, display: 'flex', gap: 8 }}>
              <button type="button" className="button button--secondary" style={{ minHeight: 34, padding: '0 11px' }} onClick={() => setArea((current) => current.slice(0, -1))}><Undo2 size={14} /> Undo point</button>
              <button type="button" className="button button--secondary" style={{ minHeight: 34, padding: '0 11px' }} onClick={() => setArea([])}><X size={14} /> Clear area</button>
            </div>
          )}
        </div>

        <div className="zone-manager__form">
          <label><span>Zone name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Covered Staging" /></label>
          <label><span>Zone type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="staging">Staging</option><option value="open-yard">Open yard</option><option value="roof">Roof</option><option value="other">Other</option></select></label>

          <div className="zone-manager__task-section">
            <div className="zone-manager__task-title"><span>Approved tasks</span><button type="button" className={allTasks ? 'active' : ''} onClick={() => { setAllTasks((value) => !value); setTasks([]) }}><Check size={14} /> All tasks</button></div>
            {!allTasks && <div className="zone-manager__tasks">{workerTasks.length ? workerTasks.map((task) => <button type="button" key={task} className={tasks.includes(task) ? 'active' : ''} onClick={() => toggleTask(task)}>{task}</button>) : <small>Add workers/tasks first, or choose “All tasks”.</small>}</div>}
          </div>

          <button type="button" className="button button--primary" onClick={() => void save()} disabled={saving || !apiKey || area.length < 3}><Plus size={16} /> {saving ? 'Saving zone…' : area.length < 3 ? 'Draw Zone Area First' : 'Add Approved Zone'}</button>
          {error && <div className="form-error">{error}</div>}
        </div>
      </div>

      <div className="zone-manager__list">
        {site.zones.length ? site.zones.map((zone) => {
          const zoneArea = decodeArea(zone)
          const allowed = visibleTasks(zone)
          return <article key={zone.id}>
            <span className="zone-manager__pin"><MapPin size={16} /></span>
            <div><strong>{zone.name}</strong><small>{zone.type.replace('-', ' ')} · {zoneArea.length >= 3 ? `${zoneArea.length}-point approved area` : 'Legacy point zone'} · {allowed.includes('*') ? 'All tasks' : allowed.join(', ') || 'No tasks approved'}</small></div>
            <span className="status-pill status-pill--active">Approved</span>
            <button type="button" onClick={() => void removeZone(zone.id)} aria-label={`Remove ${zone.name}`}><Trash2 size={16} /></button>
          </article>
        }) : <div className="zone-manager__empty"><ShieldCheck size={18} /><span>No approved zones yet. BETTER PLACE will stay disabled until the supervisor adds one.</span></div>}
      </div>
    </section>
  )
}
