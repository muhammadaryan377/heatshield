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

type SearchAnchor = {
  coordinate: Coordinate
  formattedAddress: string
  strict: boolean
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const USA_CENTER = { lat: 39.8283, lng: -98.5795 }
const USA_DEFAULT_ZOOM = 4
const MAX_DISTANCE_FROM_CONFIRMED_LOCATION_KM = 80

function averageCenter(points: Coordinate[]): Coordinate {
  if (!points.length) return USA_CENTER
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function distanceKm(a: Coordinate, b: Coordinate) {
  const radius = 6371
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

function isUnitedStatesResult(result: google.maps.GeocoderResult) {
  return result.address_components.some((component) => component.types.includes('country') && component.short_name === 'US')
}

function isSpecificSearch(result: google.maps.GeocoderResult) {
  return !result.types.includes('administrative_area_level_1') && !result.types.includes('country')
}

export function CreateSiteModal({ open, onClose, onCreated }: CreateSiteModalProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonRef = useRef<google.maps.Polygon | null>(null)
  const pointMarkersRef = useRef<google.maps.Marker[]>([])
  const locationMarkerRef = useRef<google.maps.Marker | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const searchAnchorRef = useRef<SearchAnchor | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [points, setPoints] = useState<Coordinate[]>([])
  const [searchAnchor, setSearchAnchor] = useState<SearchAnchor | null>(null)
  const [mapMessage, setMapMessage] = useState<string | null>('Search and confirm a USA location before drawing the work-site boundary.')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const center = useMemo(() => averageCenter(points), [points])
  const hasName = name.trim().length >= 2
  const hasBoundary = points.length >= 3
  const hasConfirmedLocation = Boolean(searchAnchor)
  const canSave = hasName && hasConfirmedLocation && hasBoundary && !saving
  const resolvedAddress = searchAnchor?.formattedAddress ?? address.trim()

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
          mapTypeControlOptions: { position: googleInstance.maps.ControlPosition.RIGHT_BOTTOM },
          gestureHandling: 'greedy',
        })
        mapRef.current = map
        setMapReady(true)

        clickListenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return
          const anchor = searchAnchorRef.current
          if (!anchor) {
            setError('Search and confirm a USA city, ZIP code, address, or place before drawing the site.')
            setMapMessage('Boundary drawing is locked until a USA location is confirmed.')
            return
          }

          const next = { lat: event.latLng.lat(), lng: event.latLng.lng() }
          if (anchor.strict && distanceKm(anchor.coordinate, next) > MAX_DISTANCE_FROM_CONFIRMED_LOCATION_KM) {
            setError(`That point is too far from ${anchor.formattedAddress}. Search the correct USA location first.`)
            setMapMessage('The boundary must stay near the confirmed work location.')
            return
          }

          setPoints((current) => current.length >= 80 ? current : [...current, next])
          setError(null)
          setMapMessage(null)
        })
      })
      .catch((err: Error) => setMapMessage(err.message))

    return () => {
      cancelled = true
      setMapReady(false)
      clickListenerRef.current?.remove()
      clickListenerRef.current = null
      polygonRef.current?.setMap(null)
      polygonRef.current = null
      pointMarkersRef.current.forEach((marker) => marker.setMap(null))
      pointMarkersRef.current = []
      locationMarkerRef.current?.setMap(null)
      locationMarkerRef.current = null
      mapRef.current = null
    }
  }, [open])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !window.google?.maps) return

    polygonRef.current?.setMap(null)
    polygonRef.current = null
    pointMarkersRef.current.forEach((marker) => marker.setMap(null))
    pointMarkersRef.current = []
    if (!points.length) return

    polygonRef.current = new window.google.maps.Polygon({
      paths: points,
      map,
      strokeColor: '#18b4a4',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#0b8b87',
      fillOpacity: points.length >= 3 ? 0.3 : 0,
      clickable: false,
    })

    pointMarkersRef.current = points.map((point, index) => new window.google.maps.Marker({
      map,
      position: point,
      zIndex: 40,
      title: `Site boundary point ${index + 1}`,
      label: { text: String(index + 1), color: '#ffffff', fontSize: '10px', fontWeight: '700' },
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        fillColor: '#0b8b87',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        scale: 9,
      },
    }))
  }, [mapReady, points])

  const clearConfirmedLocation = () => {
    setSearchAnchor(null)
    searchAnchorRef.current = null
    locationMarkerRef.current?.setMap(null)
    locationMarkerRef.current = null
  }

  const reset = () => {
    setName('')
    setAddress('')
    setPoints([])
    clearConfirmedLocation()
    setError(null)
    setMapMessage('Search and confirm a USA location before drawing the work-site boundary.')
    setSearching(false)
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
    setMapMessage('Finding this location inside the United States…')

    geocoder.geocode({ address: address.trim(), componentRestrictions: { country: 'US' } }, (results, status) => {
      setSearching(false)
      if (status !== 'OK' || !results?.[0]) {
        clearConfirmedLocation()
        setPoints([])
        setMapMessage('USA location not found. Try “Miami, FL”, a ZIP code, or a full US street address.')
        return
      }

      const result = results[0]
      if (!isUnitedStatesResult(result)) {
        clearConfirmedLocation()
        setPoints([])
        setError('HeatShield FortyGuard sites are currently restricted to verified United States locations.')
        setMapMessage('Search a US city, ZIP code, address, or place name.')
        return
      }

      const location = result.geometry.location
      const anchor: SearchAnchor = {
        coordinate: { lat: location.lat(), lng: location.lng() },
        formattedAddress: result.formatted_address,
        strict: isSpecificSearch(result),
      }
      searchAnchorRef.current = anchor
      setSearchAnchor(anchor)
      setAddress(result.formatted_address)
      setPoints([])

      if (result.geometry.viewport) mapRef.current?.fitBounds(result.geometry.viewport, 72)
      else {
        mapRef.current?.panTo(location)
        mapRef.current?.setZoom(18)
      }
      if ((mapRef.current?.getZoom() ?? 0) < 15) mapRef.current?.setZoom(17)
      mapRef.current?.setMapTypeId(window.google.maps.MapTypeId.SATELLITE)

      locationMarkerRef.current?.setMap(null)
      locationMarkerRef.current = new window.google.maps.Marker({
        position: location,
        map: mapRef.current,
        title: result.formatted_address,
      })

      setMapMessage(`USA location confirmed: ${result.formatted_address}. Now click the actual work-area corners.`)
    })
  }

  const addressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    findAddress()
  }

  const changeAddress = (value: string) => {
    setAddress(value)
    if (searchAnchor) {
      clearConfirmedLocation()
      setPoints([])
      setMapMessage('Location text changed. Search again to confirm the USA location before drawing.')
    }
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
    setPoints([])
    clearConfirmedLocation()
    setMapMessage('USA overview. Search and confirm the target work location before drawing a boundary.')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) {
      if (!hasName) setError('Give this site a name before saving.')
      else if (!hasConfirmedLocation) setError('Search and confirm the USA work location before saving.')
      else if (!hasBoundary) setError('Select at least 3 map points to define the work-site boundary.')
      return
    }

    if (searchAnchor?.strict && distanceKm(searchAnchor.coordinate, center) > MAX_DISTANCE_FROM_CONFIRMED_LOCATION_KM) {
      setError(`The saved boundary center is too far from ${searchAnchor.formattedAddress}. Search the correct location and redraw the boundary.`)
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
    : !hasConfirmedLocation
      ? 'Search and confirm a USA location'
      : !hasBoundary
        ? `Select ${Math.max(0, 3 - points.length)} more boundary point${3 - points.length === 1 ? '' : 's'}`
        : 'Ready to save'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="site-builder-modal" role="dialog" aria-modal="true" aria-labelledby="create-site-title">
        <div className="site-builder-modal__header">
          <div>
            <span className="eyebrow">USA SITE SETUP</span>
            <h2 id="create-site-title">Create a FortyGuard work site</h2>
            <p>Your physical location does not matter. Search the US work location, confirm it, then draw the real site polygon.</p>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close site builder" disabled={saving}><X size={20} /></button>
        </div>

        <form className="site-builder-modal__body" onSubmit={submit}>
          <aside className="site-builder-form">
            <div className="site-builder-form__scroll">
              <div className="site-builder-progress" aria-label="Site creation steps">
                <span className={hasName ? 'is-complete' : 'is-active'}><i>1</i> Name</span>
                <span className={hasConfirmedLocation ? 'is-complete' : hasName ? 'is-active' : ''}><i>2</i> US location</span>
                <span className={hasBoundary ? 'is-complete' : points.length ? 'is-active' : ''}><i>3</i> Boundary</span>
                <span className={canSave ? 'is-active' : ''}><i>4</i> Save</span>
              </div>

              <div className="site-builder-section">
                <div className="site-builder-section__heading"><span>1</span><div><strong>Name the site</strong><small>This is how your team will identify it.</small></div></div>
                <label><span>Site name</span><input value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="e.g. Miami Logistics Yard" autoFocus /></label>
              </div>

              <div className="site-builder-section">
                <div className="site-builder-section__heading"><span>2</span><div><strong>Confirm the US location</strong><small>Required so Pakistan/browser location can never affect the FortyGuard AOI.</small></div></div>
                <label>
                  <span>US city / ZIP / address</span>
                  <div className="field-with-action">
                    <input value={address} onChange={(event) => changeAddress(event.target.value)} onKeyDown={addressKeyDown} placeholder="e.g. Miami, FL or 33101" />
                    <button type="button" onClick={findAddress} aria-label="Find address" disabled={!address.trim() || searching}>{searching ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}</button>
                  </div>
                </label>
                {searchAnchor && <div className="site-ready-summary"><CheckCircle2 size={20}/><div><strong>United States location confirmed</strong><span>{searchAnchor.formattedAddress} · {searchAnchor.coordinate.lat.toFixed(5)}, {searchAnchor.coordinate.lng.toFixed(5)}</span></div></div>}
              </div>

              <div className="site-builder-section">
                <div className="site-builder-section__heading"><span>3</span><div><strong>Draw the exact work area</strong><small>Drawing unlocks only after the US location is confirmed. A new search clears old points automatically.</small></div></div>
                <div className={`boundary-status${hasBoundary ? ' boundary-status--ready' : ''}`}>
                  <div className="boundary-status__icon">{hasBoundary ? <CheckCircle2 size={21} /> : <MousePointer2 size={20} />}</div>
                  <div><strong>{hasBoundary ? 'Boundary ready' : hasConfirmedLocation ? 'Select boundary corners' : 'Confirm location first'}</strong><span>{points.length} point{points.length === 1 ? '' : 's'} selected · {hasBoundary ? 'site area is ready to save' : 'minimum 3 required'}</span></div>
                </div>
                <div className="site-builder-tools">
                  <button type="button" onClick={undoPoint} disabled={!points.length}><Undo2 size={16}/> Undo last point</button>
                  <button type="button" onClick={clearBoundary} disabled={!points.length}><RotateCcw size={16}/> Start boundary again</button>
                  <button type="button" onClick={showUSA}><MapPin size={16}/> USA overview</button>
                </div>
              </div>

              {hasBoundary && <div className="site-ready-summary"><CheckCircle2 size={20}/><div><strong>FortyGuard AOI ready</strong><span>{points.length} boundary dots · polygon center {center.lat.toFixed(5)}, {center.lng.toFixed(5)}</span></div></div>}

              <details className="site-builder-help">
                <summary>Why this is locked to the USA</summary>
                <ol><li>Your computer can be anywhere, including Pakistan.</li><li>The searched US location controls where the map jumps.</li><li>The drawn polygon controls the exact FortyGuard AOI and site timezone.</li><li>Changing the search clears the old polygon so a Miami site cannot accidentally keep another Florida location.</li></ol>
              </details>

              {error && <div className="form-error">{error}</div>}
            </div>

            <div className="site-builder-actions site-builder-actions--sticky">
              <div className="site-builder-actions__status">{canSave ? <CheckCircle2 size={16}/> : <MapPin size={16}/>}<span>{missingLabel}</span></div>
              <button type="button" className="button" onClick={close} disabled={saving}>Cancel</button>
              <button type="submit" className="button button--primary site-builder-save" disabled={!canSave}>{saving ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>} {saving ? 'Saving Site…' : 'Save Site'}</button>
            </div>
          </aside>

          <div className="site-builder-map-wrap">
            {apiKey ? <div ref={mapElement} className="site-builder-map" /> : <div className="site-builder-map-missing"><MapPin size={28}/><strong>Google Maps key required</strong><p>Add `VITE_GOOGLE_MAPS_API_KEY` to the frontend environment to draw real US site areas.</p></div>}
            {apiKey && <div className="site-builder-map-search" role="search"><Search size={18}/><input value={address} onChange={(event) => changeAddress(event.target.value)} onKeyDown={addressKeyDown} aria-label="Search USA map" placeholder="Search Miami, FL, ZIP, US address…"/><button type="button" onClick={findAddress} disabled={!address.trim() || searching}>{searching ? <LoaderCircle className="spin" size={17}/> : 'Confirm US location'}</button></div>}
            <div className="site-builder-map-tip"><MousePointer2 size={15}/>{hasBoundary ? `${points.length} numbered dots selected · FortyGuard AOI ready` : hasConfirmedLocation ? 'US location confirmed · click actual site corners' : 'Search and confirm a US location before drawing'}</div>
            {mapMessage && <div className="site-builder-map-message">{mapMessage}</div>}
          </div>
        </form>
      </section>
    </div>
  )
}
