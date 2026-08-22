import { ArrowLeft, Check, MapPin, UserPlus } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { loadGoogleMaps } from '../lib/googleMaps'
import { api } from '../lib/api'
import type { Coordinate, Site, WorkerCreate } from '../types/site'

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function WorkerMap({ site, coordinate, onChange }: { site: Site; coordinate: Coordinate; onChange: (point: Coordinate) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)

  useEffect(() => {
    if (!apiKey || !container.current) return
    let cancelled = false
    let polygon: google.maps.Polygon | null = null
    let listener: google.maps.MapsEventListener | null = null

    loadGoogleMaps(apiKey).then((g) => {
      if (cancelled || !container.current) return
      const map = new g.maps.Map(container.current, {
        center: site.center,
        zoom: 18,
        mapTypeId: g.maps.MapTypeId.SATELLITE,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
      })
      mapRef.current = map
      polygon = new g.maps.Polygon({ paths: site.polygon, map, strokeColor: '#35c6b8', strokeWeight: 3, fillColor: '#0b8b87', fillOpacity: 0.2 })
      const bounds = new g.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 45)

      const marker = new g.maps.Marker({ position: coordinate, map, draggable: true, title: 'Worker location' })
      markerRef.current = marker
      marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) onChange({ lat: event.latLng.lat(), lng: event.latLng.lng() })
      })
      listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        marker.setPosition(point)
        onChange(point)
      })
    })

    return () => {
      cancelled = true
      listener?.remove()
      polygon?.setMap(null)
      markerRef.current?.setMap(null)
      markerRef.current = null
      mapRef.current = null
    }
  }, [site.id])

  useEffect(() => { markerRef.current?.setPosition(coordinate) }, [coordinate.lat, coordinate.lng])

  if (!apiKey) {
    return <div className="worker-map-missing"><MapPin size={24} /><strong>Google Maps key required</strong><p>Configure the frontend key to place the worker precisely inside the site.</p></div>
  }
  return <div ref={container} className="worker-location-map" />
}

export function AddWorkerPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState(searchParams.get('site') ?? '')
  const [coordinate, setCoordinate] = useState<Coordinate>({ lat: 25.2048, lng: 55.2708 })
  const [form, setForm] = useState<WorkerCreate>({
    name: '', role: '', task: '', location: 'Site area', locationId: 'site-area',
    coordinate, workIntensity: 'moderate', sunExposure: 'direct', shadeAccess: 'limited', waterAccess: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSite = sites.find((site) => site.id === siteId) ?? null

  useEffect(() => {
    api.listSites().then((loaded) => {
      setSites(loaded)
      const preferred = loaded.some((site) => site.id === siteId) ? siteId : loaded[0]?.id ?? ''
      setSiteId(preferred)
      const site = loaded.find((item) => item.id === preferred)
      if (site) setCoordinate(site.center)
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load sites.'))
  }, [])

  useEffect(() => {
    if (!selectedSite) return
    setCoordinate(selectedSite.center)
    setForm((current) => ({ ...current, coordinate: selectedSite.center }))
  }, [siteId])

  const updateCoordinate = (point: Coordinate) => {
    setCoordinate(point)
    setForm((current) => ({ ...current, coordinate: point }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!siteId || !form.name.trim() || !form.role.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.createWorker(siteId, { ...form, name: form.name.trim(), role: form.role.trim(), coordinate })
      navigate(`/?site=${encodeURIComponent(siteId)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add worker.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell>
      <div className="worker-page-header">
        <button type="button" className="button button--quiet" onClick={() => navigate(selectedSite ? `/?site=${selectedSite.id}` : '/')}><ArrowLeft size={16} /> Back</button>
        <div><span className="eyebrow">WORKFORCE SETUP</span><h1>Add Worker</h1><p>Create a real worker profile and place the worker at their actual work position.</p></div>
      </div>

      <form className="add-worker-layout" onSubmit={submit}>
        <section className="worker-form-card panel">
          {!sites.length ? (
            <div className="worker-empty-state"><span className="worker-empty-state__icon"><MapPin size={24} /></span><div><strong>Create a site first</strong><p>Workers must belong to a work site.</p></div><button type="button" className="button button--primary" onClick={() => navigate('/')}>Go to Home</button></div>
          ) : (
            <>
              <div className="form-section-title"><UserPlus size={18} /><div><strong>Worker details</strong><span>All data is saved against the selected site.</span></div></div>
              <div className="form-grid">
                <label><span>Site</span><select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                <label><span>Worker name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Full name" required /></label>
                <label><span>Role</span><input value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} placeholder="e.g. Roofer" required /></label>
                <label><span>Current task</span><input value={form.task ?? ''} onChange={(event) => setForm({ ...form, task: event.target.value })} placeholder="What are they doing?" /></label>
                <label><span>Work intensity</span><select value={form.workIntensity} onChange={(event) => setForm({ ...form, workIntensity: event.target.value as WorkerCreate['workIntensity'] })}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
                <label><span>Sun exposure</span><select value={form.sunExposure} onChange={(event) => setForm({ ...form, sunExposure: event.target.value as WorkerCreate['sunExposure'] })}><option value="indoor">Indoor</option><option value="partial">Partial</option><option value="direct">Direct sun</option></select></label>
                <label><span>Shade access</span><select value={form.shadeAccess} onChange={(event) => setForm({ ...form, shadeAccess: event.target.value as WorkerCreate['shadeAccess'] })}><option value="available">Available</option><option value="limited">Limited</option><option value="none">None</option></select></label>
                <label><span>Shift start</span><input type="time" value={form.shiftStart ?? ''} onChange={(event) => setForm({ ...form, shiftStart: event.target.value })} /></label>
                <label><span>Shift end</span><input type="time" value={form.shiftEnd ?? ''} onChange={(event) => setForm({ ...form, shiftEnd: event.target.value })} /></label>
                <label className="toggle-field"><input type="checkbox" checked={Boolean(form.waterAccess)} onChange={(event) => setForm({ ...form, waterAccess: event.target.checked })} /><span>Water access available</span></label>
              </div>
              {error && <div className="form-error">{error}</div>}
              <div className="worker-form-actions"><button type="button" className="button" onClick={() => navigate(selectedSite ? `/?site=${selectedSite.id}` : '/')}>Cancel</button><button type="submit" className="button button--primary" disabled={saving || !form.name.trim() || !form.role.trim()}><Check size={17} /> {saving ? 'Saving…' : 'Save Worker'}</button></div>
            </>
          )}
        </section>

        <section className="worker-map-card panel">
          <div className="worker-map-card__header"><div><span className="eyebrow">EXACT POSITION</span><h2>Worker location</h2><p>Click inside the site or drag the marker to the worker's actual position.</p></div></div>
          {selectedSite ? <WorkerMap site={selectedSite} coordinate={coordinate} onChange={updateCoordinate} /> : <div className="worker-map-missing"><MapPin size={24} /><strong>No site selected</strong></div>}
          <div className="coordinate-strip"><span>Lat {coordinate.lat.toFixed(6)}</span><span>Lng {coordinate.lng.toFixed(6)}</span>{selectedSite && <strong>{selectedSite.name}</strong>}</div>
        </section>
      </form>
    </AppShell>
  )
}
