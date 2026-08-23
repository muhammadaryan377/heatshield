import { Check, LoaderCircle, MapPin, RotateCcw, Save, Undo2, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import { siteManagementApi } from '../../lib/siteManagementApi'
import type { Coordinate, Site, SiteProfile } from '../../types/site'

interface Props {
  open: boolean
  site: Site | null
  onClose: () => void
  onUpdated: (site: Site) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function averageCenter(points: Coordinate[], fallback: Coordinate): Coordinate {
  if (!points.length) return fallback
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function defaultProfile(site: Site): SiteProfile {
  return site.profile ?? {
    siteType: 'other',
    operatingStart: null,
    operatingEnd: null,
    surfaceType: 'mixed',
    shadeAvailability: 'unknown',
    waterStations: 0,
    recoveryAreas: 0,
    supervisor: null,
    emergencyPoint: null,
    defaultShift: null,
    typicalTasks: [],
  }
}

export function EditSiteModal({ open, site, onClose, onUpdated }: Props) {
  const mapNode = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonRef = useRef<google.maps.Polygon | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const drawingRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [points, setPoints] = useState<Coordinate[]>([])
  const [profile, setProfile] = useState<SiteProfile | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    drawingRef.current = drawing
    mapRef.current?.setOptions({ draggableCursor: drawing ? 'crosshair' : null })
  }, [drawing])

  useEffect(() => {
    if (!site || !open) return
    setName(site.name)
    setAddress(site.address)
    setStatus(site.status)
    setPoints(site.polygon)
    setProfile(defaultProfile(site))
    setDrawing(false)
    setError(null)
  }, [open, site])

  const center = useMemo(() => site ? averageCenter(points, site.center) : { lat: 0, lng: 0 }, [points, site])

  useEffect(() => {
    if (!open || !site || !apiKey || !mapNode.current) return
    let cancelled = false
    setMapReady(false)
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
      })
      mapRef.current = map
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 48)
      listenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!drawingRef.current || !event.latLng) return
        const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        setPoints((current) => current.length >= 80 ? current : [...current, next])
      })
      setMapReady(true)
    }).catch((err: Error) => setError(err.message))
    return () => {
      cancelled = true
      setMapReady(false)
      listenerRef.current?.remove()
      listenerRef.current = null
      polygonRef.current?.setMap(null)
      markersRef.current.forEach((marker) => marker.setMap(null))
      markersRef.current = []
      mapRef.current = null
    }
  }, [open, site?.id])

  useEffect(() => {
    polygonRef.current?.setMap(null)
    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current = []
    if (!mapReady || !mapRef.current || !window.google?.maps || !points.length) return
    polygonRef.current = new google.maps.Polygon({
      map: mapRef.current,
      paths: points,
      strokeColor: '#0b8b87',
      strokeWeight: 3,
      strokeOpacity: 1,
      fillColor: '#11a39b',
      fillOpacity: points.length >= 3 ? 0.18 : 0,
      clickable: false,
    })
    markersRef.current = points.map((point, index) => new google.maps.Marker({
      map: mapRef.current,
      position: point,
      zIndex: 30,
      title: `Boundary point ${index + 1}`,
      label: { text: String(index + 1), color: '#ffffff', fontSize: '10px', fontWeight: '700' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: '#0b8b87', fillOpacity: 1,
        strokeColor: '#ffffff', strokeWeight: 2, scale: 9,
      },
    }))
  }, [mapReady, points])

  if (!open || !site || !profile) return null

  const setProfileField = <K extends keyof SiteProfile>(key: K, value: SiteProfile[K]) => {
    setProfile((current) => current ? { ...current, [key]: value } : current)
  }

  const beginRedraw = () => {
    setPoints([])
    setDrawing(true)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim().length < 2) { setError('Site name must contain at least 2 characters.'); return }
    if (address.trim().length < 2) { setError('Add a site address or location label.'); return }
    if (points.length < 3) { setError('Site boundary needs at least 3 map points.'); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await siteManagementApi.updateSite(site.id, {
        name: name.trim(),
        address: address.trim(),
        status,
        center,
        polygon: points,
        profile,
      })
      onUpdated(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this site.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="site-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-site-title">
      <header className="site-edit-modal__head">
        <div><span className="eyebrow">SITE CONFIGURATION</span><h2 id="edit-site-title">Edit {site.name}</h2><p>Update the operational profile or redraw the exact saved boundary.</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Close site editor"><X size={20}/></button>
      </header>
      <form className="site-edit-modal__body" onSubmit={submit}>
        <div className="site-edit-form">
          <div className="site-edit-grid">
            <label><span>Site name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <label className="wide"><span>Address / location</span><input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            <label><span>Site type</span><select value={profile.siteType} onChange={(e) => setProfileField('siteType', e.target.value as SiteProfile['siteType'])}><option value="construction">Construction</option><option value="warehouse">Warehouse</option><option value="industrial">Industrial</option><option value="utilities">Utilities</option><option value="logistics">Logistics</option><option value="other">Other</option></select></label>
            <label><span>Surface</span><select value={profile.surfaceType} onChange={(e) => setProfileField('surfaceType', e.target.value as SiteProfile['surfaceType'])}><option value="mixed">Mixed</option><option value="asphalt">Asphalt</option><option value="concrete">Concrete</option><option value="roof">Roof</option><option value="soil">Soil</option><option value="other">Other</option></select></label>
            <label><span>Operating start</span><input type="time" value={profile.operatingStart ?? ''} onChange={(e) => setProfileField('operatingStart', e.target.value || null)} /></label>
            <label><span>Operating end</span><input type="time" value={profile.operatingEnd ?? ''} onChange={(e) => setProfileField('operatingEnd', e.target.value || null)} /></label>
            <label><span>Shade availability</span><select value={profile.shadeAvailability} onChange={(e) => setProfileField('shadeAvailability', e.target.value as SiteProfile['shadeAvailability'])}><option value="good">Good</option><option value="limited">Limited</option><option value="none">None</option><option value="unknown">Unknown</option></select></label>
            <label><span>Water stations</span><input type="number" min="0" max="100" value={profile.waterStations} onChange={(e) => setProfileField('waterStations', Math.max(0, Number(e.target.value) || 0))} /></label>
            <label><span>Recovery areas</span><input type="number" min="0" max="50" value={profile.recoveryAreas} onChange={(e) => setProfileField('recoveryAreas', Math.max(0, Number(e.target.value) || 0))} /></label>
            <label><span>Supervisor</span><input value={profile.supervisor ?? ''} onChange={(e) => setProfileField('supervisor', e.target.value || null)} placeholder="Supervisor name" /></label>
            <label className="wide"><span>Emergency point</span><input value={profile.emergencyPoint ?? ''} onChange={(e) => setProfileField('emergencyPoint', e.target.value || null)} placeholder="e.g. North gate first-aid station" /></label>
            <label className="wide"><span>Typical tasks</span><input value={profile.typicalTasks.join(', ')} onChange={(e) => setProfileField('typicalTasks', e.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20))} placeholder="Roof work, loading, inspection" /></label>
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="site-edit-map-column">
          <div className="site-edit-map-tools">
            <div><strong>Site boundary</strong><span>{points.length} point{points.length === 1 ? '' : 's'} · {points.length >= 3 ? 'ready' : 'minimum 3'}</span></div>
            <button type="button" onClick={beginRedraw}><RotateCcw size={15}/> Redraw</button>
            <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length}><Undo2 size={15}/> Undo</button>
            <button type="button" onClick={() => setDrawing((value) => !value)} className={drawing ? 'active' : ''}><MapPin size={15}/> {drawing ? 'Drawing on' : 'Draw points'}</button>
          </div>
          {apiKey ? <div ref={mapNode} className="site-edit-map" /> : <div className="site-edit-map-empty"><MapPin size={26}/><strong>Google Maps key required</strong></div>}
          <div className="site-edit-map-note"><Check size={15}/> Every drawing click is shown as a numbered dot. HeatShield closes the boundary automatically.</div>
        </div>
        <footer className="site-edit-actions"><button type="button" className="button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button--primary" disabled={saving || points.length < 3}>{saving ? <LoaderCircle className="spin" size={17}/> : <Save size={17}/>} {saving ? 'Saving…' : 'Save Site Changes'}</button></footer>
      </form>
    </section>
  </div>
}
