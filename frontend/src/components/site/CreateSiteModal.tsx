import { Check, MapPin, RotateCcw, Search, Undo2, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Coordinate, Site } from '../../types/site'

interface CreateSiteModalProps {
  open: boolean
  onClose: () => void
  onCreated: (site: Site) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const DEFAULT_CENTER = { lat: 25.2048, lng: 55.2708 }

function averageCenter(points: Coordinate[]): Coordinate {
  if (!points.length) return DEFAULT_CENTER
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

export function CreateSiteModal({ open, onClose, onCreated }: CreateSiteModalProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonRef = useRef<google.maps.Polygon | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [points, setPoints] = useState<Coordinate[]>([])
  const [mapMessage, setMapMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = name.trim().length >= 2 && address.trim().length >= 2 && points.length >= 3 && !saving
  const center = useMemo(() => averageCenter(points), [points])

  useEffect(() => {
    if (!open || !mapElement.current || !apiKey) return
    let cancelled = false

    loadGoogleMaps(apiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return
        const map = new googleInstance.maps.Map(mapElement.current, {
          center: DEFAULT_CENTER,
          zoom: 15,
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
        })
        mapRef.current = map
        clickListenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return
          const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
          setPoints((current) => [...current, next])
        })
      })
      .catch((err: Error) => setMapMessage(err.message))

    return () => {
      cancelled = true
      clickListenerRef.current?.remove()
      clickListenerRef.current = null
      polygonRef.current?.setMap(null)
      polygonRef.current = null
      mapRef.current = null
    }
  }, [open])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return
    polygonRef.current?.setMap(null)
    if (!points.length) return

    polygonRef.current = new window.google.maps.Polygon({
      paths: points,
      map,
      strokeColor: '#18b4a4',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#0b8b87',
      fillOpacity: 0.3,
      clickable: false,
    })
  }, [points])

  const reset = () => {
    setName('')
    setAddress('')
    setPoints([])
    setError(null)
    setMapMessage(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const findAddress = () => {
    if (!address.trim() || !mapRef.current || !window.google?.maps) return
    const geocoder = new window.google.maps.Geocoder()
    setMapMessage('Finding location…')
    geocoder.geocode({ address }, (results, status) => {
      if (status !== 'OK' || !results?.[0]) {
        setMapMessage('Address could not be located. Pan the map manually and draw the site area.')
        return
      }
      const result = results[0]
      mapRef.current?.panTo(result.geometry.location)
      mapRef.current?.setZoom(18)
      setAddress(result.formatted_address)
      setMapMessage('Location found. Click around the site boundary to draw the full area.')
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const site = await api.createSite({ name: name.trim(), address: address.trim(), center, polygon: points, zones: [] })
      onCreated(site)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create site.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="site-builder-modal" role="dialog" aria-modal="true" aria-labelledby="create-site-title">
        <div className="site-builder-modal__header">
          <div>
            <span className="eyebrow">SITE SETUP</span>
            <h2 id="create-site-title">Create a work site</h2>
            <p>Search the location, then click around the complete work area to draw its boundary.</p>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close site builder"><X size={20} /></button>
        </div>

        <form className="site-builder-modal__body" onSubmit={submit}>
          <aside className="site-builder-form">
            <label>
              <span>Site name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Downtown Tower Project" autoFocus />
            </label>
            <label>
              <span>Address / location</span>
              <div className="field-with-action">
                <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Search an address" />
                <button type="button" onClick={findAddress} aria-label="Find address"><Search size={18} /></button>
              </div>
            </label>

            <div className="boundary-status">
              <div className="boundary-status__icon"><MapPin size={20} /></div>
              <div>
                <strong>{points.length < 3 ? 'Draw the site boundary' : 'Boundary ready'}</strong>
                <span>{points.length} map point{points.length === 1 ? '' : 's'} selected {points.length < 3 ? '— minimum 3' : '— ready to save'}</span>
              </div>
            </div>

            <div className="site-builder-tools">
              <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length}><Undo2 size={16} /> Undo point</button>
              <button type="button" onClick={() => setPoints([])} disabled={!points.length}><RotateCcw size={16} /> Clear boundary</button>
            </div>

            <div className="site-builder-help">
              <strong>How to select the site</strong>
              <ol>
                <li>Find the work location.</li>
                <li>Click each corner of the actual work area.</li>
                <li>Use at least three points to cover the whole site.</li>
                <li>Save. HeatShield will analyze the selected area.</li>
              </ol>
            </div>

            {error && <div className="form-error">{error}</div>}
            <div className="site-builder-actions">
              <button type="button" className="button" onClick={close}>Cancel</button>
              <button type="submit" className="button button--primary" disabled={!canSave}>
                <Check size={17} /> {saving ? 'Creating…' : 'Create Site'}
              </button>
            </div>
          </aside>

          <div className="site-builder-map-wrap">
            {apiKey ? <div ref={mapElement} className="site-builder-map" /> : (
              <div className="site-builder-map-missing">
                <MapPin size={28} />
                <strong>Google Maps key required</strong>
                <p>Add `VITE_GOOGLE_MAPS_API_KEY` to the frontend environment to draw real site areas.</p>
              </div>
            )}
            <div className="site-builder-map-tip">Click map corners to draw the work-site polygon</div>
            {mapMessage && <div className="site-builder-map-message">{mapMessage}</div>}
          </div>
        </form>
      </section>
    </div>
  )
}
