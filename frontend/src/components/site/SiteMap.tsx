import {
  Flame,
  Layers3,
  LoaderCircle,
  LocateFixed,
  MapPinned,
  Minus,
  Plus,
  RotateCcw,
  ThermometerSun,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Coordinate, Site, ThermalMapResponse, Worker } from '../../types/site'

interface SiteMapProps {
  site: Site
  workers: Worker[]
  temperatureC?: number | null
  weatherLabel?: string | null
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function markerColor(risk: Worker['risk']) {
  if (risk === 'high' || risk === 'extreme') return '#f38a22'
  if (risk === 'medium') return '#e7b028'
  return '#1ca79d'
}

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

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.2) return '#1f9f9a'
  if (ratio < 0.4) return '#69b96d'
  if (ratio < 0.6) return '#e5c54d'
  if (ratio < 0.8) return '#ef8b2c'
  return '#e34a43'
}

function temperatureBand(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = (value - min) / span
  if (ratio >= 0.8) return 'Hottest zone'
  if (ratio >= 0.6) return 'Hot zone'
  if (ratio >= 0.4) return 'Moderate zone'
  if (ratio >= 0.2) return 'Cooler zone'
  return 'Coolest zone'
}

function observedLabel(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function MapFallback({ site, workers }: Pick<SiteMapProps, 'site' | 'workers'>) {
  const points = site.polygon.length > 0 ? site.polygon : [site.center]
  const latitudes = points.map((point) => point.lat)
  const longitudes = points.map((point) => point.lng)
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLng = Math.min(...longitudes)
  const maxLng = Math.max(...longitudes)
  const latSpan = Math.max(maxLat - minLat, 0.001)
  const lngSpan = Math.max(maxLng - minLng, 0.001)
  const toPercent = (lat: number, lng: number) => ({ left: `${((lng - minLng) / lngSpan) * 74 + 13}%`, top: `${(1 - (lat - minLat) / latSpan) * 66 + 14}%` })

  return (
    <div className="site-map__fallback" aria-label="Site boundary preview waiting for Google Maps configuration">
      <div className="site-map__fallback-grid" />
      <svg className="site-map__fallback-polygon" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={points.map((point) => { const pos = toPercent(point.lat, point.lng); return `${parseFloat(pos.left)},${parseFloat(pos.top)}` }).join(' ')} fill="rgba(11, 139, 135, 0.24)" stroke="#26b5aa" strokeWidth="0.7" />
      </svg>
      {workers.map((worker) => <div key={worker.id} className={`fallback-worker fallback-worker--${worker.risk}`} style={toPercent(worker.coordinate.lat, worker.coordinate.lng)} title={`${worker.name} — ${worker.risk} risk`}><UserRound size={14} /></div>)}
      <div className="site-map__fallback-message"><strong>Google Maps key required</strong><span>Add `VITE_GOOGLE_MAPS_API_KEY` to render the real site map.</span></div>
    </div>
  )
}

export function SiteMap({ site, workers, temperatureC, weatherLabel }: SiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const draftPolygonRef = useRef<google.maps.Polygon | null>(null)
  const draftMarkersRef = useRef<google.maps.Marker[]>([])
  const thermalPolygonsRef = useRef<google.maps.Polygon[]>([])
  const thermalInfoWindowsRef = useRef<google.maps.InfoWindow[]>([])
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [mapVersion, setMapVersion] = useState(0)
  const [thermalOpen, setThermalOpen] = useState(false)
  const [thermalMode, setThermalMode] = useState<'site' | 'custom'>('site')
  const [selection, setSelection] = useState<Coordinate[]>([])
  const [granularity, setGranularity] = useState(100)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [thermalLoading, setThermalLoading] = useState(false)
  const [thermalError, setThermalError] = useState<string | null>(null)
  const hasMapKey = Boolean(apiKey)
  const boundsCenter = useMemo(() => site.center, [site.center.lat, site.center.lng])

  useEffect(() => {
    setThermal(null)
    setSelection([])
    setThermalError(null)
  }, [site.id])

  useEffect(() => {
    if (!hasMapKey || !containerRef.current) return
    let cancelled = false
    let polygon: google.maps.Polygon | null = null
    const markers: google.maps.Marker[] = []
    const infoWindows: google.maps.InfoWindow[] = []

    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !containerRef.current) return
      const map = new googleInstance.maps.Map(containerRef.current, {
        center: boundsCenter, zoom: 17, mapTypeId: mapType,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy', backgroundColor: '#e4eaeb',
      })
      mapRef.current = map
      polygon = new googleInstance.maps.Polygon({
        paths: site.polygon,
        strokeColor: '#38d0c1',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#0b8b87',
        fillOpacity: thermal?.dataStatus === 'verified' ? 0.08 : 0.28,
        clickable: false,
        map,
      })
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 48)

      workers.forEach((worker) => {
        const marker = new googleInstance.maps.Marker({
          position: worker.coordinate, map, title: `${worker.name} — ${worker.risk} risk`, zIndex: 30,
          icon: { path: googleInstance.maps.SymbolPath.CIRCLE, fillColor: markerColor(worker.risk), fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3, scale: 11 },
        })
        const info = new googleInstance.maps.InfoWindow({ content: `<strong>${worker.name}</strong><br/>${worker.role}<br/>${worker.location}` })
        marker.addListener('click', () => info.open({ map, anchor: marker }))
        markers.push(marker); infoWindows.push(info)
      })
      setMapVersion((value) => value + 1)
    }).catch((error: Error) => { if (!cancelled) setMapError(error.message) })

    return () => {
      cancelled = true
      polygon?.setMap(null)
      markers.forEach((marker) => marker.setMap(null))
      infoWindows.forEach((info) => info.close())
      mapRef.current = null
    }
  }, [boundsCenter, hasMapKey, mapType, site.polygon, workers])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !thermalOpen || thermalMode !== 'custom') return
    map.setOptions({ draggableCursor: 'crosshair' })
    const listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return
      const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }
      if (!pointInPolygon(point, site.polygon)) {
        setThermalError('Select thermal-area points inside the site boundary.')
        return
      }
      setThermalError(null)
      setThermal(null)
      setSelection((current) => current.length >= 24 ? current : [...current, point])
    })
    return () => {
      google.maps.event.removeListener(listener)
      map.setOptions({ draggableCursor: null })
    }
  }, [mapVersion, site.polygon, thermalMode, thermalOpen])

  useEffect(() => {
    draftPolygonRef.current?.setMap(null)
    draftMarkersRef.current.forEach((marker) => marker.setMap(null))
    draftPolygonRef.current = null
    draftMarkersRef.current = []

    const map = mapRef.current
    if (!map || thermalMode !== 'custom' || !selection.length || !window.google?.maps) return

    draftMarkersRef.current = selection.map((point, index) => new google.maps.Marker({
      map,
      position: point,
      zIndex: 40,
      title: `Area point ${index + 1}`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: '#ffffff',
        fillOpacity: 1,
        strokeColor: '#0b8b87',
        strokeWeight: 2,
        scale: 5,
      },
    }))

    if (selection.length >= 2) {
      draftPolygonRef.current = new google.maps.Polygon({
        map,
        paths: selection,
        strokeColor: '#0b8b87',
        strokeWeight: 2,
        strokeOpacity: 1,
        fillColor: '#10a39c',
        fillOpacity: selection.length >= 3 ? 0.16 : 0,
        clickable: false,
        zIndex: 20,
      })
    }

    return () => {
      draftPolygonRef.current?.setMap(null)
      draftMarkersRef.current.forEach((marker) => marker.setMap(null))
    }
  }, [mapVersion, selection, thermalMode])

  useEffect(() => {
    thermalPolygonsRef.current.forEach((polygon) => polygon.setMap(null))
    thermalInfoWindowsRef.current.forEach((info) => info.close())
    thermalPolygonsRef.current = []
    thermalInfoWindowsRef.current = []

    const map = mapRef.current
    if (!map || thermal?.dataStatus !== 'verified' || !window.google?.maps) return
    const min = thermal.minTemperatureC ?? 0
    const max = thermal.maxTemperatureC ?? min

    thermal.tiles.forEach((tile) => {
      const polygon = new google.maps.Polygon({
        map,
        paths: tile.polygon,
        strokeColor: heatColor(tile.temperatureC, min, max),
        strokeOpacity: 0.78,
        strokeWeight: tile.id === thermal.hottestTileId ? 2.4 : 1,
        fillColor: heatColor(tile.temperatureC, min, max),
        fillOpacity: 0.58,
        clickable: true,
        zIndex: 10,
      })
      const label = temperatureBand(tile.temperatureC, min, max)
      const info = new google.maps.InfoWindow({
        content: `<div style="min-width:132px"><strong>${tile.temperatureC.toFixed(1)}°C</strong><br/><span>${label}</span><br/><small>FortyGuard thermal cell</small></div>`,
      })
      polygon.addListener('click', (event: google.maps.PolyMouseEvent) => {
        thermalInfoWindowsRef.current.forEach((windowInfo) => windowInfo.close())
        if (event.latLng) info.setPosition(event.latLng)
        info.open({ map })
      })
      thermalPolygonsRef.current.push(polygon)
      thermalInfoWindowsRef.current.push(info)
    })

    return () => {
      thermalPolygonsRef.current.forEach((polygon) => polygon.setMap(null))
      thermalInfoWindowsRef.current.forEach((info) => info.close())
    }
  }, [mapVersion, thermal])

  const zoom = (delta: number) => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 17) + delta)
  const recenter = () => { mapRef.current?.panTo(site.center); mapRef.current?.setZoom(17) }
  const toggleLayers = () => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')

  const chooseMode = (mode: 'site' | 'custom') => {
    setThermalMode(mode)
    setThermal(null)
    setThermalError(null)
    if (mode === 'site') setSelection([])
  }

  const clearThermal = () => {
    setThermal(null)
    setThermalError(null)
    setSelection([])
  }

  const generateThermalMap = async () => {
    if (!hasMapKey) {
      setThermalError('Google Maps must be configured before visualizing a thermal layer.')
      return
    }
    if (thermalMode === 'custom' && selection.length < 3) {
      setThermalError('Select at least three points inside the site to create a custom thermal area.')
      return
    }

    setThermalLoading(true)
    setThermalError(null)
    try {
      const response = await api.generateThermalMap(site.id, {
        mode: thermalMode,
        polygon: thermalMode === 'custom' ? selection : undefined,
        granularityMeters: granularity,
      })
      setThermal(response)
      if (response.dataStatus !== 'verified') {
        setThermalError(response.message ?? 'Verified FortyGuard thermal cells are not available for this area.')
      }
    } catch (error) {
      setThermal(null)
      setThermalError(error instanceof Error ? error.message : 'Could not generate the thermal map.')
    } finally {
      setThermalLoading(false)
    }
  }

  return (
    <section className={`site-map-card panel${thermalOpen ? ' site-map-card--thermal-open' : ''}`}>
      <div className="site-map-card__site-chip"><div><strong>{site.name}</strong><span>{site.address}</span></div><span className="status-pill status-pill--active">Active</span></div>
      {temperatureC != null ? <div className="site-map-card__weather-chip"><span className="sun-symbol">☀</span><span><strong>{temperatureC.toFixed(1)}°C</strong><small>{weatherLabel ?? 'Live'}</small></span></div> : <div className="site-map-card__weather-chip site-map-card__weather-chip--pending"><span>Live data pending</span></div>}

      <button
        type="button"
        className={`thermal-map-toggle${thermalOpen ? ' thermal-map-toggle--active' : ''}`}
        onClick={() => setThermalOpen((value) => !value)}
        aria-expanded={thermalOpen}
      >
        <Flame size={17} /> Thermal Map
      </button>

      <div className="site-map-card__canvas">{hasMapKey && !mapError ? <div ref={containerRef} className="site-map__google" /> : <MapFallback site={site} workers={workers} />}</div>

      {thermalOpen && (
        <aside className="thermal-explorer" aria-label="Thermal map controls">
          <div className="thermal-explorer__header">
            <div><span className="thermal-explorer__eyebrow">FORTYGUARD SPATIAL LAYER</span><strong>Thermal Explorer</strong></div>
            <button type="button" onClick={() => setThermalOpen(false)} aria-label="Close thermal explorer"><X size={17} /></button>
          </div>
          <p>See where the selected site is hotter or cooler using actual provider temperature cells.</p>

          <div className="thermal-mode-switch" role="group" aria-label="Thermal area mode">
            <button type="button" className={thermalMode === 'site' ? 'active' : ''} onClick={() => chooseMode('site')}><MapPinned size={15} /> Whole Site</button>
            <button type="button" className={thermalMode === 'custom' ? 'active' : ''} onClick={() => chooseMode('custom')}><Plus size={15} /> Select Area</button>
          </div>

          {thermalMode === 'custom' && (
            <div className="thermal-selection-box">
              <div><strong>{selection.length} point{selection.length === 1 ? '' : 's'} selected</strong><span>{selection.length < 3 ? 'Click at least 3 points inside the site.' : 'Area ready. Add more points or generate.'}</span></div>
              <div>
                <button type="button" onClick={() => { setSelection((current) => current.slice(0, -1)); setThermal(null) }} disabled={!selection.length}>Undo</button>
                <button type="button" onClick={clearThermal} disabled={!selection.length && !thermal}>Clear</button>
              </div>
            </div>
          )}

          <label className="thermal-resolution">
            <span>Cell resolution</span>
            <select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value)); setThermal(null) }}>
              <option value={50}>50 m · detailed</option>
              <option value={100}>100 m · balanced</option>
              <option value={200}>200 m · faster</option>
            </select>
          </label>

          <button
            type="button"
            className="button button--primary thermal-generate"
            onClick={() => void generateThermalMap()}
            disabled={thermalLoading || !hasMapKey || (thermalMode === 'custom' && selection.length < 3)}
          >
            {thermalLoading ? <LoaderCircle className="thermal-spin" size={17} /> : <ThermometerSun size={17} />}
            {thermalLoading ? 'Requesting FortyGuard…' : thermal ? 'Refresh Thermal Map' : 'Generate Thermal Map'}
          </button>

          {thermal?.dataStatus === 'verified' && (
            <div className="thermal-summary">
              <div><span>Coolest</span><strong>{thermal.minTemperatureC?.toFixed(1)}°C</strong></div>
              <div><span>Mean</span><strong>{thermal.meanTemperatureC?.toFixed(1)}°C</strong></div>
              <div><span>Hottest</span><strong>{thermal.maxTemperatureC?.toFixed(1)}°C</strong></div>
              <p>{thermal.tileCount} verified cells · {thermal.granularityMeters} m · {thermal.cached ? 'cached result' : observedLabel(thermal.observedAt)}</p>
            </div>
          )}

          {thermalError && <div className="thermal-message thermal-message--warning">{thermalError}</div>}
          {thermal?.dataStatus === 'verified' && thermal.message && <div className="thermal-message">{thermal.message}</div>}
          {!hasMapKey && <div className="thermal-message thermal-message--warning">Google Maps is required to visualize spatial thermal cells.</div>}
        </aside>
      )}

      {thermal?.dataStatus === 'verified' && (
        <div className="thermal-legend">
          <span>Cooler</span><i className="thermal-legend__scale" /><span>Hotter</span>
          <strong>{thermal.minTemperatureC?.toFixed(1)}°C — {thermal.maxTemperatureC?.toFixed(1)}°C</strong>
        </div>
      )}

      <div className="site-map-card__controls" aria-label="Map controls">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in"><Plus size={18} /></button><button type="button" onClick={() => zoom(-1)} aria-label="Zoom out"><Minus size={18} /></button><button type="button" onClick={recenter} aria-label="Recenter map"><LocateFixed size={18} /></button><button type="button" onClick={toggleLayers} aria-label="Toggle map layer"><Layers3 size={18} /></button>
        {(thermal || selection.length > 0) && <button type="button" onClick={clearThermal} aria-label="Clear thermal layer" title="Clear thermal layer"><RotateCcw size={17} /></button>}
      </div>
      {!workers.length && <div className="site-map-worker-empty">0 workers assigned to this site</div>}
      {mapError && <div className="site-map-card__error">{mapError}</div>}
      <div className="site-map-card__google-label">Google</div>
    </section>
  )
}
