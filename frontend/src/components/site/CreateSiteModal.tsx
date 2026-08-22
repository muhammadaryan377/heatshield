import {
  Check,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  MousePointer2,
  RotateCcw,
  Search,
  Undo2,
  X,
} from 'lucide-react'
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Coordinate, Site } from '../../types/site'

interface CreateSiteModalProps {
  open: boolean
  onClose: () => void
  onCreated: (site: Site) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const USA_CENTER = { lat: 39.8283, lng: -98.5795 }
const USA_DEFAULT_ZOOM = 4

function averageCenter(points: Coordinate[]): Coordinate {
  if (!points.length) return USA_CENTER
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

export function CreateSiteModal({ open, onClose, onCreated }: CreateSiteModalProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonRef = useRef<google.maps.Polygon | null>(null)
  const locationMarkerRef = useRef<google.maps.Marker | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [points, setPoints] = useState<Coordinate[]>([])
  const [mapMessage, setMapMessage] = useState<string | null>('Search anywhere in the USA, then draw the work-site boundary.')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const center = useMemo(() => averageCenter(points), [points])
  const hasName = name.trim().length >= 2
  const hasBoundary = points.length >= 3
  const canSave = hasName && hasBoundary && !saving
  const resolvedAddress = address.trim() || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`

  useEffect(() => {
    if (!open || !mapElement.current || !apiKey) return
    let cancelled = false

    loadGoogleMaps(apiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return

        const map = new googleInstance.maps.Map(mapElement.current, {
          center: USA_CENTER,
          zoom: USA_DEFAULT_ZOOM,
          minZoom: 3,
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          mapTypeControlOptions: {
            position: googleInstance.maps.ControlPosition.RIGHT_BOTTOM,
          },
          gestureHandling: 'greedy',
        })
        mapRef.current = map

        clickListenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return
          const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
          setPoints((current) => [...current, next])
          setMapMessage(null)
        })
      })
      .catch((err: Error) => setMapMessage(err.message))

    return () => {
      cancelled = true
      clickListenerRef.current?.remove()
      clickListenerRef.current = null
      polygonRef.current?.setMap(null)
      polygonRef.current = null
      locationMarkerRef.current?.setMap(null)
      locationMarkerRef.current = null
      mapRef.current = null
    }
  }, [open])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return

    polygonRef.current?.setMap(null)
    polygonRef.current = null
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
    setMapMessage('Search anywhere in the USA, then draw the work-site boundary.')
    setSearching(false)
    locationMarkerRef.current?.setMap(null)
    locationMarkerRef.current = null
  }

  const close = () => {
    if (saving) return
    reset()
    onClose()
  }

  const findAddress = () => {
    if (!address.trim() || !mapRef.current || !window.google?.maps || searching) return

    const geocoder = new window.google.maps.Geocoder()
    setSearching(true)
    setError(null)
    setMapMessage('Finding location in the USA…')

    geocoder.geocode({ address: address.trim(), region: 'US' }, (results, status) => {
      setSearching(false)
      if (status !== 'OK' || !results?.[0]) {
        setMapMessage('Location not found. Try a city, ZIP code, street address, or a more specific place name.')
        return
      }

      const result = results[0]
      const location = result.geometry.location
      if (result.geometry.viewport) {
        mapRef.current?.fitBounds(result.geometry.viewport, 72)
      } else {
        mapRef.current?.panTo(location)
        mapRef.current?.setZoom(18)
      }
      if ((mapRef.current?.getZoom() ?? 0) < 15) mapRef.current?.setZoom(17)
      mapRef.current?.setMapTypeId(window.google.maps.MapTypeId.SATELLITE)
      setAddress(result.formatted_address)

      locationMarkerRef.current?.setMap(null)
      locationMarkerRef.current = new window.google.maps.Marker({
        position: location,
        map: mapRef.current,
        title: result.formatted_address,
      })

      setMapMessage('Location found. Click around the actual work-area corners to define the site.')
    })
  }

  const addressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    findAddress()
  }

  const undoPoint = () => {
    setPoints((current) => current.slice(0, -1))
    setError(null)
  }

  const clearBoundary = () => {
    setPoints([])
    setError(null)
  }

  const showUSA = () => {
    if (!mapRef.current) return
    mapRef.current.panTo(USA_CENTER)
    mapRef.current.setZoom(USA_DEFAULT_ZOOM)
    locationMarkerRef.current?.setMap(null)
    locationMarkerRef.current = null
    setMapMessage('USA overview. Search a city, ZIP code, address, or place to jump to the work site.')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) {
      if (!hasName) setError('Give this site a name before saving.')
      else if (!hasBoundary) setError('Select at least 3 map points to define the work-site boundary.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const site = await api.createSite({
        name: name.trim(),
        address: resolvedAddress,
        center,
        polygon: points,
        zones: [],
      })
      onCreated(site)
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this site. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const missingLabel = !hasName
    ? 'Add a site name to continue'
    : !hasBoundary
      ? `Select ${Math.max(0, 3 - points.length)} more boundary point${3 - points.length === 1 ? '' : 's'}`
      : 'Ready to save'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="site-builder-modal" role="dialog" aria-modal="true" aria-labelledby="create-site-title">
        <div className="site-builder-modal__header">
          <div>
            <span className="eyebrow">SITE SETUP</span>
            <h2 id="create-site-title">Create a work site</h2>
            <p>Search the USA, draw the complete work area, then save it to HeatShield.</p>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close site builder" disabled={saving}><X size={20} /></button>
        </div>

        <form className="site-builder-modal__body" onSubmit={submit}>
          <aside className="site-builder-form">
            <div className="site-builder-form__scroll">
              <div className="site-builder-progress" aria-label="Site creation steps">
                <span className={hasName ? 'is-complete' : 'is-active'}><i>1</i> Name</span>
                <span className={address.trim() ? 'is-complete' : ''}><i>2</i> Locate</span>
                <span className={hasBoundary ? 'is-complete' : points.length ? 'is-active' : ''}><i>3</i> Boundary</span>
                <span className={canSave ? 'is-active' : ''}><i>4</i> Save</span>
              </div>

              <div className="site-builder-section">
                <div className="site-builder-section__heading">
                  <span>1</span>
                  <div><strong>Name the site</strong><small>This is how your team will identify it.</small></div>
                </div>
                <label>
                  <span>Site name</span>
                  <input
                    value={name}
                    onChange={(event) => { setName(event.target.value); setError(null) }}
                    placeholder="e.g. Downtown Tower Project"
                    autoFocus
                  />
                </label>
              </div>

              <div className="site-builder-section">
                <div className="site-builder-section__heading">
                  <span>2</span>
                  <div><strong>Find the location</strong><small>Search by city, ZIP code, address, or place name.</small></div>
                </div>
                <label>
                  <span>Address / location</span>
                  <div className="field-with-action">
                    <input
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      onKeyDown={addressKeyDown}
                      placeholder="e.g. Phoenix AZ, 85004, or street address"
                    />
                    <button type="button" onClick={findAddress} aria-label="Find address" disabled={!address.trim() || searching}>
                      {searching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
                    </button>
                  </div>
                </label>
              </div>

              <div className="site-builder-section">
                <div className="site-builder-section__heading">
                  <span>3</span>
                  <div><strong>Draw the work area</strong><small>Click each outer corner. HeatShield closes the polygon automatically.</small></div>
                </div>

                <div className={`boundary-status${hasBoundary ? ' boundary-status--ready' : ''}`}>
                  <div className="boundary-status__icon">{hasBoundary ? <CheckCircle2 size={21} /> : <MousePointer2 size={20} />}</div>
                  <div>
                    <strong>{hasBoundary ? 'Boundary ready' : 'Select boundary corners'}</strong>
                    <span>{points.length} point{points.length === 1 ? '' : 's'} selected · {hasBoundary ? 'site area is ready to save' : 'minimum 3 required'}</span>
                  </div>
                </div>

                <div className="site-builder-tools">
                  <button type="button" onClick={undoPoint} disabled={!points.length}><Undo2 size={16} /> Undo last point</button>
                  <button type="button" onClick={clearBoundary} disabled={!points.length}><RotateCcw size={16} /> Start boundary again</button>
                  <button type="button" onClick={showUSA}><MapPin size={16} /> USA overview</button>
                </div>
              </div>

              {hasBoundary && (
                <div className="site-ready-summary">
                  <CheckCircle2 size={20} />
                  <div>
                    <strong>Site is ready</strong>
                    <span>{points.length} boundary points · center {center.lat.toFixed(5)}, {center.lng.toFixed(5)}</span>
                  </div>
                </div>
              )}

              <details className="site-builder-help">
                <summary>How site selection works</summary>
                <ol>
                  <li>The map starts with a USA overview.</li>
                  <li>Search a city, ZIP code, address, or place to jump to the work location.</li>
                  <li>Click the outside corners of the real work area.</li>
                  <li>Use Undo if a point is misplaced, then press Save Site.</li>
                </ol>
              </details>

              {error && <div className="form-error">{error}</div>}
            </div>

            <div className="site-builder-actions site-builder-actions--sticky">
              <div className="site-builder-actions__status">
                {canSave ? <CheckCircle2 size={16} /> : <MapPin size={16} />}
                <span>{missingLabel}</span>
              </div>
              <button type="button" className="button" onClick={close} disabled={saving}>Cancel</button>
              <button type="submit" className="button button--primary site-builder-save" disabled={!canSave}>
                {saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                {saving ? 'Saving Site…' : 'Save Site'}
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

            {apiKey && (
              <div className="site-builder-map-search" role="search">
                <Search size={18} />
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onKeyDown={addressKeyDown}
                  aria-label="Search USA map"
                  placeholder="Search USA city, ZIP, address, or place…"
                />
                <button type="button" onClick={findAddress} disabled={!address.trim() || searching}>
                  {searching ? <LoaderCircle className="spin" size={17} /> : 'Search'}
                </button>
              </div>
            )}

            <div className="site-builder-map-tip">
              <MousePointer2 size={15} />
              {hasBoundary ? `${points.length} points selected · boundary ready` : 'Search first, then click map corners to draw the work-site boundary'}
            </div>
            {mapMessage && <div className="site-builder-map-message">{mapMessage}</div>}
          </div>
        </form>
      </section>
    </div>
  )
}
