import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  FileJson,
  Layers3,
  LoaderCircle,
  MapPin,
  MousePointer2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ThermometerSun,
  Undo2,
  X,
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import { loadGoogleMaps } from '../lib/googleMaps'
import { filterUrbanDistricts, registerUrbanDistrict } from '../lib/urbanDistricts'
import type { Coordinate, Site, ThermalMapResponse } from '../types/site'
import '../urban-districts.css'

const SELECTED_DISTRICT_KEY = 'heatshield:selected-urban-district'
const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const DEFAULT_CENTER: Coordinate = { lat: 25, lng: 0 }
const DEFAULT_ZOOM = 2
const FORTYGUARD_GRANULARITY_METERS = 80

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function observedLabel(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function temperature(value?: number | null) {
  return value == null ? '—' : `${value.toFixed(1)}°C`
}

function averageCenter(points: Coordinate[]): Coordinate {
  if (!points.length) return DEFAULT_CENTER
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function polygonAreaKm2(points: Coordinate[]) {
  if (points.length < 3) return 0
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length
  const radius = 6_371_000
  const latScale = Math.PI / 180
  const projected = points.map((point) => ({
    x: radius * point.lng * latScale * Math.cos(meanLat * latScale),
    y: radius * point.lat * latScale,
  }))

  let doubleArea = 0
  projected.forEach((point, index) => {
    const next = projected[(index + 1) % projected.length]
    doubleArea += point.x * next.y - next.x * point.y
  })
  return Math.abs(doubleArea) / 2 / 1_000_000
}

function formatArea(value: number) {
  if (value <= 0) return '—'
  if (value < 0.01) return `${Math.round(value * 1_000_000).toLocaleString()} m²`
  if (value < 10) return `${value.toFixed(2)} km²`
  return `${value.toFixed(1)} km²`
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#168f87'
  if (ratio < 0.34) return '#58ad69'
  if (ratio < 0.52) return '#d4bf38'
  if (ratio < 0.70) return '#f0a02c'
  if (ratio < 0.86) return '#ec6833'
  return '#cf3945'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ringFromCoordinates(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return []

  const points = value.flatMap((position) => {
    if (!Array.isArray(position) || position.length < 2) return []
    const lng = Number(position[0])
    const lat = Number(position[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return []
    return [{ lat, lng }]
  })

  if (
    points.length > 1
    && points[0].lat === points[points.length - 1].lat
    && points[0].lng === points[points.length - 1].lng
  ) {
    return points.slice(0, -1)
  }
  return points
}

function polygonCandidates(value: unknown): Coordinate[][] {
  if (!isRecord(value)) return []
  const type = value.type

  if (type === 'FeatureCollection') {
    const features = Array.isArray(value.features) ? value.features : []
    return features.flatMap((feature) => polygonCandidates(feature))
  }

  if (type === 'Feature') {
    return polygonCandidates(value.geometry)
  }

  if (type === 'Polygon') {
    const coordinates = Array.isArray(value.coordinates) ? value.coordinates : []
    const ring = ringFromCoordinates(coordinates[0])
    return ring.length >= 3 ? [ring] : []
  }

  if (type === 'MultiPolygon') {
    const polygons = Array.isArray(value.coordinates) ? value.coordinates : []
    return polygons.flatMap((polygon) => {
      if (!Array.isArray(polygon)) return []
      const ring = ringFromCoordinates(polygon[0])
      return ring.length >= 3 ? [ring] : []
    })
  }

  return []
}

function DistrictBoundaryMap({
  district,
  thermal,
}: {
  district: Site
  thermal: ThermalMapResponse | null
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const thermalRefs = useRef<google.maps.Polygon[]>([])
  const [mapVersion, setMapVersion] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapsApiKey || !mapElement.current) return
    let cancelled = false
    setMapError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return

        const map = new googleInstance.maps.Map(mapElement.current, {
          center: district.center,
          zoom: 14,
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
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0b8b87',
          fillOpacity: 0.08,
          clickable: false,
          zIndex: 20,
        })

        const bounds = new googleInstance.maps.LatLngBounds()
        district.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 38)
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      boundaryRef.current?.setMap(null)
      boundaryRef.current = null
      thermalRefs.current.forEach((polygon) => polygon.setMap(null))
      thermalRefs.current = []
      mapRef.current = null
    }
  }, [district.id, district.center.lat, district.center.lng, district.polygon])

  useEffect(() => {
    thermalRefs.current.forEach((polygon) => polygon.setMap(null))
    thermalRefs.current = []

    const map = mapRef.current
    if (!map || thermal?.dataStatus !== 'verified' || !window.google?.maps || !thermal.tiles.length) return

    const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
    const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))
    thermalRefs.current = thermal.tiles.map((tile) => {
      const color = heatColor(tile.temperatureC, min, max)
      return new google.maps.Polygon({
        map,
        paths: tile.polygon,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: tile.id === thermal.hottestTileId ? 2.2 : 0.6,
        fillColor: color,
        fillOpacity: 0.56,
        clickable: false,
        zIndex: 10,
      })
    })
  }, [mapVersion, thermal])

  return (
    <div className="urban-district-map">
      {mapsApiKey && !mapError ? (
        <div ref={mapElement} className="urban-district-map__google" />
      ) : (
        <div className="urban-district-map__fallback">
          <Layers3 size={30} />
          <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
          <span>The saved polygon remains valid for FortyGuard even when satellite context cannot render.</span>
        </div>
      )}
      <div className="urban-district-map__chip">
        <MapPin size={14} /> {district.polygon.length} boundary vertices
      </div>
      {thermal?.dataStatus === 'verified' && (
        <div className="urban-district-map__thermal-chip">
          <ShieldCheck size={14} /> {thermal.tileCount} verified cells
        </div>
      )}
    </div>
  )
}

function CreateDistrictModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (site: Site) => void
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonRef = useRef<google.maps.Polygon | null>(null)
  const locationMarkerRef = useRef<google.maps.Marker | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [points, setPoints] = useState<Coordinate[]>([])
  const [geoJsonText, setGeoJsonText] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [mapMessage, setMapMessage] = useState('Search a place, draw the district boundary, or paste GeoJSON.')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const center = useMemo(() => averageCenter(points), [points])
  const areaKm2 = useMemo(() => polygonAreaKm2(points), [points])
  const boundaryReady = points.length >= 3 && areaKm2 > 0
  const canSave = name.trim().length >= 2 && boundaryReady && !saving
  const resolvedAddress = address.trim() || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`

  useEffect(() => {
    if (!open || !mapElement.current || !mapsApiKey) return
    let cancelled = false

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return

        const map = new googleInstance.maps.Map(mapElement.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          minZoom: 2,
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
          setPoints((current) => [...current, { lat: event.latLng!.lat(), lng: event.latLng!.lng() }])
          setMapMessage('Boundary editing active. Continue clicking outer vertices or save when complete.')
          setError(null)
        })
      })
      .catch((cause: Error) => setMapMessage(cause.message))

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

    polygonRef.current = new google.maps.Polygon({
      map,
      paths: points,
      strokeColor: '#19b5aa',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#0b8b87',
      fillOpacity: 0.24,
      clickable: false,
    })
  }, [points])

  const fitPoints = (nextPoints: Coordinate[]) => {
    if (!mapRef.current || !window.google?.maps || nextPoints.length < 1) return
    const bounds = new google.maps.LatLngBounds()
    nextPoints.forEach((point) => bounds.extend(point))
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 56)
  }

  const reset = () => {
    setName('')
    setAddress('')
    setPoints([])
    setGeoJsonText('')
    setImportMessage(null)
    setMapMessage('Search a place, draw the district boundary, or paste GeoJSON.')
    setSearching(false)
    setError(null)
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

    setSearching(true)
    setError(null)
    setMapMessage('Locating the district…')
    const geocoder = new google.maps.Geocoder()
    geocoder.geocode({ address: address.trim() }, (results, status) => {
      setSearching(false)
      if (status !== 'OK' || !results?.[0]) {
        setMapMessage('Location not found. Try a city, district, neighborhood, or a more specific place name.')
        return
      }

      const result = results[0]
      const location = result.geometry.location
      if (result.geometry.viewport) mapRef.current?.fitBounds(result.geometry.viewport, 64)
      else {
        mapRef.current?.panTo(location)
        mapRef.current?.setZoom(15)
      }
      if ((mapRef.current?.getZoom() ?? 0) < 13) mapRef.current?.setZoom(14)
      setAddress(result.formatted_address)

      locationMarkerRef.current?.setMap(null)
      locationMarkerRef.current = new google.maps.Marker({
        map: mapRef.current,
        position: location,
        title: result.formatted_address,
      })
      setMapMessage('Location found. Click the outer district vertices, or import an official GeoJSON boundary.')
    })
  }

  const addressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    findAddress()
  }

  const importGeoJson = () => {
    setError(null)
    setImportMessage(null)
    if (!geoJsonText.trim()) {
      setImportMessage('Paste a Polygon, MultiPolygon, Feature, or FeatureCollection first.')
      return
    }

    try {
      const parsed = JSON.parse(geoJsonText) as unknown
      const candidates = polygonCandidates(parsed)
      if (!candidates.length) {
        setImportMessage('No valid polygon boundary was found in this GeoJSON.')
        return
      }
      const selected = [...candidates].sort((a, b) => polygonAreaKm2(b) - polygonAreaKm2(a))[0]
      setPoints(selected)
      fitPoints(selected)
      setImportMessage(
        candidates.length > 1
          ? `Imported ${candidates.length} polygons; using the largest outer boundary (${formatArea(polygonAreaKm2(selected))}).`
          : `Boundary imported successfully (${formatArea(polygonAreaKm2(selected))}).`,
      )
      setMapMessage('Official boundary loaded. Review it on the satellite map before saving.')
    } catch {
      setImportMessage('GeoJSON could not be parsed. Check the JSON syntax and geometry structure.')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) {
      if (name.trim().length < 2) setError('Give this district a clear name before saving.')
      else if (!boundaryReady) setError('Define a valid district polygon with at least 3 vertices.')
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
      registerUrbanDistrict(site.id)
      onCreated(site)
      reset()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'District boundary could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="urban-district-modal-backdrop" role="presentation">
      <section className="urban-district-modal" role="dialog" aria-modal="true" aria-labelledby="district-builder-title">
        <header className="urban-district-modal__header">
          <div>
            <span className="urban-district-eyebrow">DISTRICT AOI BUILDER</span>
            <h2 id="district-builder-title">Create a provider-ready district boundary</h2>
            <p>The saved polygon becomes the exact area-of-interest sent to FortyGuard spatial analysis.</p>
          </div>
          <button type="button" onClick={close} disabled={saving} aria-label="Close district builder"><X size={20} /></button>
        </header>

        <form className="urban-district-builder" onSubmit={submit}>
          <aside className="urban-district-builder__form">
            <div className="urban-district-builder__scroll">
              <section className="urban-district-form-section">
                <div className="urban-district-form-section__title"><span>1</span><div><strong>District identity</strong><small>Use a stable planning or administrative name.</small></div></div>
                <label>
                  <span>District name</span>
                  <input value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="e.g. Central Business District" autoFocus />
                </label>
                <label>
                  <span>Search location</span>
                  <div className="urban-district-field-action">
                    <input value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={addressKeyDown} placeholder="City, neighborhood, address, or place" />
                    <button type="button" onClick={findAddress} disabled={!address.trim() || searching} aria-label="Search location">
                      {searching ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
                    </button>
                  </div>
                </label>
              </section>

              <section className="urban-district-form-section">
                <div className="urban-district-form-section__title"><span>2</span><div><strong>Define the AOI</strong><small>Draw manually or import an official GIS boundary.</small></div></div>
                <div className={`urban-boundary-readiness${boundaryReady ? ' urban-boundary-readiness--ready' : ''}`}>
                  {boundaryReady ? <CheckCircle2 size={20} /> : <MousePointer2 size={20} />}
                  <div>
                    <strong>{boundaryReady ? 'AOI geometry ready' : 'Boundary required'}</strong>
                    <small>{points.length} vertices · {formatArea(areaKm2)}</small>
                  </div>
                </div>
                <div className="urban-district-draw-tools">
                  <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length}><Undo2 size={15} /> Undo</button>
                  <button type="button" onClick={() => setPoints([])} disabled={!points.length}><RotateCcw size={15} /> Clear</button>
                </div>

                <details className="urban-geojson-import">
                  <summary><FileJson size={16} /> Import GeoJSON boundary</summary>
                  <p>Supports Polygon, MultiPolygon, Feature, and FeatureCollection. For multiple polygons, HeatShield uses the largest outer boundary for this district record.</p>
                  <textarea value={geoJsonText} onChange={(event) => setGeoJsonText(event.target.value)} placeholder='{"type":"Feature","geometry":{"type":"Polygon","coordinates":[...]}}' />
                  <button type="button" className="button button--secondary" onClick={importGeoJson}>Parse boundary</button>
                  {importMessage && <small className="urban-import-message">{importMessage}</small>}
                </details>
              </section>

              <section className="urban-district-form-section urban-district-provider-check">
                <div className="urban-district-form-section__title"><span>3</span><div><strong>FortyGuard handoff</strong><small>No provider values are invented at boundary creation.</small></div></div>
                <div><ShieldCheck size={17} /><span>AOI polygon</span><strong>{boundaryReady ? 'Ready' : 'Pending'}</strong></div>
                <div><Layers3 size={17} /><span>Analysis granularity</span><strong>{FORTYGUARD_GRANULARITY_METERS} m</strong></div>
                <div><ThermometerSun size={17} /><span>Thermal evidence</span><strong>Run after save</strong></div>
              </section>

              {error && <div className="urban-district-error"><AlertTriangle size={16} /> {error}</div>}
            </div>

            <footer className="urban-district-builder__actions">
              <span>{canSave ? 'Ready to create district' : 'Complete name + boundary'}</span>
              <button type="button" className="button button--secondary" onClick={close} disabled={saving}>Cancel</button>
              <button type="submit" className="button button--primary" disabled={!canSave}>
                {saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                {saving ? 'Saving…' : 'Save District'}
              </button>
            </footer>
          </aside>

          <div className="urban-district-builder__map-wrap">
            {mapsApiKey ? <div ref={mapElement} className="urban-district-builder__map" /> : (
              <div className="urban-district-builder__map-missing">
                <MapPin size={30} />
                <strong>Google Maps key required for drawing</strong>
                <p>You can still paste GeoJSON, but satellite boundary review needs `VITE_GOOGLE_MAPS_API_KEY`.</p>
              </div>
            )}
            <div className="urban-district-builder__map-message">{mapMessage}</div>
            <div className="urban-district-builder__map-metrics">
              <span><small>Vertices</small><strong>{points.length}</strong></span>
              <span><small>Area</small><strong>{formatArea(areaKm2)}</strong></span>
              <span><small>Center</small><strong>{boundaryReady ? `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}` : '—'}</strong></span>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}

export function UrbanDistrictsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [districts, setDistricts] = useState<Site[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)

    api.listSites(controller.signal)
      .then((sites) => {
        if (!active || controller.signal.aborted) return
        const urbanSites = filterUrbanDistricts(sites)
        setDistricts(urbanSites)

        const requested = searchParams.get('district')
        const stored = localStorage.getItem(SELECTED_DISTRICT_KEY)
        const preferred = [requested, stored].find((id) => id && urbanSites.some((site) => site.id === id))
        setSelectedId(preferred ?? urbanSites[0]?.id ?? null)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Could not load district boundaries.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // Initial route preference only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setThermal(null)
      return
    }
    localStorage.setItem(SELECTED_DISTRICT_KEY, selectedId)
    setSearchParams({ district: selectedId }, { replace: true })
    setThermal(null)
    setVerificationError(null)
  }, [selectedId, setSearchParams])

  const selected = useMemo(
    () => districts.find((district) => district.id === selectedId) ?? null,
    [districts, selectedId],
  )

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return districts
    return districts.filter((district) => `${district.name} ${district.address}`.toLowerCase().includes(normalized))
  }, [districts, query])

  const totalArea = useMemo(
    () => districts.reduce((sum, district) => sum + polygonAreaKm2(district.polygon), 0),
    [districts],
  )
  const selectedArea = selected ? polygonAreaKm2(selected.polygon) : 0

  const districtCreated = (district: Site) => {
    setDistricts((current) => [district, ...current.filter((item) => item.id !== district.id)])
    setSelectedId(district.id)
    setThermal(null)
    setVerificationError(null)
  }

  const verifyWithFortyGuard = async () => {
    if (!selected || verifying) return
    setVerifying(true)
    setVerificationError(null)
    setThermal(null)

    try {
      const result = await api.generateThermalMap(selected.id, {
        mode: 'site',
        granularityMeters: FORTYGUARD_GRANULARITY_METERS,
      })
      setThermal(result)
      if (result.dataStatus !== 'verified') {
        setVerificationError(result.message ?? 'FortyGuard did not return verified cells for this boundary.')
      }
    } catch (cause) {
      setVerificationError(cause instanceof Error ? cause.message : 'FortyGuard boundary verification failed.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <AppShell module="urban">
      <div className="topbar">
        <h1 className="topbar__title">Urban Heat Intelligence</h1>
        <div className="topbar__spacer" />
        <div className="module-core-status">
          <span className="module-core-status__dot" />
          <span><small>INTELLIGENCE CORE</small><strong>FortyGuard</strong></span>
        </div>
        <Link to="/" className="button button--outline-teal">All Modules</Link>
      </div>

      <main className="urban-districts-page">
        <section className="urban-districts-hero panel">
          <div>
            <span className="urban-district-eyebrow">SCREEN 02 • DISTRICT BOUNDARY REGISTRY</span>
            <h1>Define the geometry before asking the heat question.</h1>
            <p>
              Districts are first-class spatial objects. Draw or import the real AOI, keep its geometry traceable,
              and verify that FortyGuard can return thermal cells for the exact boundary before downstream analysis.
            </p>
          </div>
          <button className="button button--primary urban-districts-hero__button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> New District
          </button>
        </section>

        {loading ? (
          <StatePanel kind="loading" title="Loading district registry" detail="Reading saved spatial boundaries…" />
        ) : error && !districts.length ? (
          <StatePanel kind="error" title="District registry unavailable" detail={error} onRetry={() => window.location.reload()} />
        ) : (
          <>
            <section className="urban-district-summary-grid">
              <article className="urban-district-summary panel"><span><Building2 size={17} /> Managed districts</span><strong>{districts.length}</strong><small>{districts.filter((district) => district.status === 'active').length} active boundaries</small></article>
              <article className="urban-district-summary panel"><span><Layers3 size={17} /> Registered area</span><strong>{formatArea(totalArea)}</strong><small>Geometry-derived, not a thermal metric</small></article>
              <article className="urban-district-summary panel"><span><MapPin size={17} /> Selected AOI</span><strong>{selected ? formatArea(selectedArea) : '—'}</strong><small>{selected ? `${selected.polygon.length} polygon vertices` : 'Select a district'}</small></article>
              <article className="urban-district-summary panel"><span><ShieldCheck size={17} /> FortyGuard status</span><strong className={thermal?.dataStatus === 'verified' ? 'is-verified' : ''}>{thermal?.dataStatus === 'verified' ? 'Verified' : verifying ? 'Checking…' : 'Not checked'}</strong><small>{thermal?.dataStatus === 'verified' ? `${thermal.tileCount} returned cells` : 'Run evidence check when needed'}</small></article>
            </section>

            {!districts.length ? (
              <section className="urban-district-empty panel">
                <MapPin size={32} />
                <div><h2>No urban district boundaries yet</h2><p>Create one by drawing on satellite imagery or importing an official GeoJSON polygon.</p></div>
                <button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create District</button>
              </section>
            ) : (
              <section className="urban-districts-layout">
                <aside className="urban-district-directory panel">
                  <div className="urban-district-directory__head">
                    <div><span className="urban-district-eyebrow">DISTRICT REGISTRY</span><h2>Boundaries</h2></div>
                    <button type="button" onClick={() => setCreateOpen(true)} aria-label="Add district"><Plus size={18} /></button>
                  </div>
                  <div className="urban-district-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search districts" /></div>
                  <div className="urban-district-list">
                    {filtered.map((district) => {
                      const active = district.id === selectedId
                      return (
                        <button key={district.id} type="button" className={`urban-district-list__item${active ? ' is-active' : ''}`} onClick={() => setSelectedId(district.id)}>
                          <span className="urban-district-list__icon"><MapPin size={18} /></span>
                          <span className="urban-district-list__copy"><strong>{district.name}</strong><small>{district.address || 'Saved polygon boundary'}</small><span>{formatArea(polygonAreaKm2(district.polygon))} · {district.polygon.length} vertices</span></span>
                          <ChevronRight size={17} />
                        </button>
                      )
                    })}
                    {!filtered.length && <div className="urban-district-list__none">No district matches “{query}”.</div>}
                  </div>
                </aside>

                {selected && (
                  <div className="urban-district-detail">
                    <section className="urban-district-detail__map panel">
                      <DistrictBoundaryMap district={selected} thermal={thermal} />
                    </section>

                    <section className="urban-district-profile panel">
                      <div className="urban-district-profile__head">
                        <div><span className="urban-district-eyebrow">SELECTED DISTRICT</span><h2>{selected.name}</h2><p>{selected.address}</p></div>
                        <span className="urban-district-aoi-badge"><CheckCircle2 size={15} /> AOI geometry ready</span>
                      </div>

                      <div className="urban-district-profile__metrics">
                        <div><small>Boundary area</small><strong>{formatArea(selectedArea)}</strong><span>Calculated from saved polygon</span></div>
                        <div><small>Boundary vertices</small><strong>{selected.polygon.length}</strong><span>Provider AOI geometry</span></div>
                        <div><small>FortyGuard granularity</small><strong>{FORTYGUARD_GRANULARITY_METERS} m</strong><span>Verification request setting</span></div>
                        <div><small>Thermal evidence</small><strong>{thermal?.dataStatus === 'verified' ? `${thermal.tileCount} cells` : 'Not verified'}</strong><span>{thermal?.dataStatus === 'verified' ? observedLabel(thermal.observedAt) : 'No synthetic cells shown'}</span></div>
                      </div>

                      <div className="urban-district-profile__actions">
                        <button type="button" className="button button--secondary" onClick={verifyWithFortyGuard} disabled={verifying}>
                          <RefreshCw size={16} className={verifying ? 'spin' : ''} /> {verifying ? 'Checking FortyGuard…' : 'Verify FortyGuard AOI'}
                        </button>
                        <Link className="button button--primary" to={`/urban?district=${encodeURIComponent(selected.id)}`}>Open District Overview <ArrowRight size={15} /></Link>
                        <Link className="button button--outline-teal" to={`/urban/heat-islands?district=${encodeURIComponent(selected.id)}`}>Heat Islands <ArrowRight size={15} /></Link>
                      </div>

                      {verificationError && (
                        <div className="urban-district-verification-warning"><AlertTriangle size={16} /><span>{verificationError}</span></div>
                      )}

                      {thermal?.dataStatus === 'verified' && (
                        <div className="urban-district-verification-result">
                          <div><ShieldCheck size={18} /><span><strong>Provider boundary accepted</strong><small>FortyGuard returned real spatial cells for this AOI.</small></span></div>
                          <div className="urban-district-verification-result__metrics">
                            <span><small>Mean</small><strong>{temperature(thermal.meanTemperatureC)}</strong></span>
                            <span><small>Minimum</small><strong>{temperature(thermal.minTemperatureC)}</strong></span>
                            <span><small>Maximum</small><strong>{temperature(thermal.maxTemperatureC)}</strong></span>
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="urban-district-method panel">
                      <div><ShieldCheck size={19} /><span><strong>Why this screen exists</strong><small>Heat-island results are only defensible when the analysis boundary is explicit, stable, and reviewable.</small></span></div>
                      <div className="urban-district-method__flow"><span>District AOI</span><i>→</i><span>FortyGuard cells</span><i>→</i><span>Heat Islands</span><i>→</i><span>Interventions</span></div>
                    </section>
                  </div>
                )}
              </section>
            )}

            {error && districts.length > 0 && <div className="urban-district-inline-error"><AlertTriangle size={16} /> {error}</div>}
          </>
        )}
      </main>

      <CreateDistrictModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={districtCreated} />
    </AppShell>
  )
}
