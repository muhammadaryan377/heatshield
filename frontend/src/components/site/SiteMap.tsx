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
import './SiteMapOverlay.css'

interface SiteMapProps {
  site: Site
  workers: Worker[]
  temperatureC?: number | null
  weatherLabel?: string | null
}

type Granularity = 60 | 80 | 100

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function markerColor(risk: Worker['risk']) {
  if (risk === 'high' || risk === 'extreme') return '#ef6a47'
  if (risk === 'medium') return '#e7a51a'
  return '#0b8b87'
}

function workerMarkerSvg(worker: Worker) {
  const fill = markerColor(worker.risk)
  const initials = escapeHtml((worker.initials || worker.name.slice(0, 1) || 'W').slice(0, 2).toUpperCase())
  const alert = worker.risk === 'high' || worker.risk === 'extreme' ? '#ef4f45' : worker.risk === 'medium' ? '#f2a51f' : '#19a56d'

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg width="48" height="58" viewBox="0 0 48 58" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="s" x="0" y="0" width="48" height="58" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="4" stdDeviation="3.5" flood-color="#102d33" flood-opacity="0.28"/>
        </filter>
      </defs>
      <g filter="url(#s)">
        <path d="M24 53C24 53 42 38.2 42 23.2C42 13.15 33.94 5 24 5C14.06 5 6 13.15 6 23.2C6 38.2 24 53 24 53Z" fill="white"/>
        <path d="M24 49C24 49 38.2 36.3 38.2 23.4C38.2 15.35 31.84 8.8 24 8.8C16.16 8.8 9.8 15.35 9.8 23.4C9.8 36.3 24 49 24 49Z" fill="${fill}"/>
        <circle cx="24" cy="22.2" r="9.8" fill="white" fill-opacity="0.16"/>
        <circle cx="24" cy="18.9" r="3.45" fill="white"/>
        <path d="M17.8 28.4C18.55 24.85 20.6 23.15 24 23.15C27.4 23.15 29.45 24.85 30.2 28.4" stroke="white" stroke-width="2.6" stroke-linecap="round"/>
        <rect x="15.2" y="31.7" width="17.6" height="8.2" rx="4.1" fill="white" fill-opacity="0.96"/>
        <text x="24" y="37.25" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" fill="${fill}">${initials}</text>
        <circle cx="36.4" cy="11.6" r="5.2" fill="white"/>
        <circle cx="36.4" cy="11.6" r="3.5" fill="${alert}"/>
      </g>
    </svg>
  `)}`
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
  if (ratio >= 0.8) return 'Warmest relative zone'
  if (ratio >= 0.6) return 'Warmer relative zone'
  if (ratio >= 0.4) return 'Mid-range zone'
  if (ratio >= 0.2) return 'Cooler relative zone'
  return 'Coolest relative zone'
}

function observedLabel(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function escapeHtml(value?: string | null) {
  const input = value ?? ''
  return input.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character)
}

function workerRecommendation(worker: Worker) {
  if (worker.risk === 'extreme') return 'Stop or relocate this task and reassess exposure immediately.'
  if (worker.risk === 'high') return 'Reassign or reduce exposure before continuing this task.'
  if (worker.risk === 'medium') return 'Monitor exposure and schedule a recovery break.'
  return 'Normal work may continue with routine monitoring.'
}

function workerPopupHtml(worker: Worker, currentCellTemperature?: number | null) {
  const risk = worker.risk.charAt(0).toUpperCase() + worker.risk.slice(1)
  const tone = worker.risk === 'high' || worker.risk === 'extreme' ? 'danger' : worker.risk === 'medium' ? 'watch' : 'safe'
  const currentTemperature = currentCellTemperature == null ? '—' : `${currentCellTemperature.toFixed(1)}°C`
  return `
    <div class="worker-map-popup" data-worker-popup="${escapeHtml(worker.id)}">
      <div class="worker-map-popup__header">
        <span class="worker-map-popup__avatar"><span>${escapeHtml((worker.initials || worker.name.slice(0, 1)).slice(0, 2).toUpperCase())}</span></span>
        <span><strong>${escapeHtml(worker.name)}</strong><small>${escapeHtml(worker.role)} • ${escapeHtml(worker.location)}</small></span>
      </div>
      <div class="worker-map-popup__metrics">
        <div><span>Current cell temp</span><strong>${currentTemperature}</strong></div>
        <div><span>Exposure level</span><strong class="worker-map-popup__risk worker-map-popup__risk--${tone}">${risk}</strong></div>
        <div><span>Last check-in</span><strong>${escapeHtml(worker.lastCheckIn || '—')}</strong></div>
        <div><span>Current task</span><strong>${escapeHtml(worker.task || 'Not set')}</strong></div>
      </div>
      <div class="worker-map-popup__recommendation">
        <span>Recommendation</span>
        <strong>${escapeHtml(workerRecommendation(worker))}</strong>
      </div>
      <div class="worker-map-popup__actions">
        <button type="button" data-action="view">View Worker</button>
        <button type="button" class="primary" data-action="adjust">Adjust Assignment</button>
      </div>
    </div>
  `
}

function keepPopupInsideMap(map: google.maps.Map, popup: Element) {
  const mapDiv = map.getDiv()
  const shell = popup.closest('.gm-style-iw-t') ?? popup.closest('.gm-style-iw-c') ?? popup
  const mapRect = mapDiv.getBoundingClientRect()
  const popupRect = shell.getBoundingClientRect()
  const sideInset = 18
  const topInset = 112
  const bottomInset = 22
  let dx = 0
  let dy = 0

  if (popupRect.left < mapRect.left + sideInset) dx = popupRect.left - (mapRect.left + sideInset)
  else if (popupRect.right > mapRect.right - sideInset) dx = popupRect.right - (mapRect.right - sideInset)

  if (popupRect.top < mapRect.top + topInset) dy = popupRect.top - (mapRect.top + topInset)
  else if (popupRect.bottom > mapRect.bottom - bottomInset) dy = popupRect.bottom - (mapRect.bottom - bottomInset)

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy(dx, dy)
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
  const thermalOverlayRef = useRef<google.maps.OverlayView | null>(null)
  const thermalClickListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const thermalInfoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const workerInfoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const thermalRef = useRef<ThermalMapResponse | null>(null)
  const temperatureRef = useRef<number | null | undefined>(temperatureC)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [mapVersion, setMapVersion] = useState(0)
  const [thermalOpen, setThermalOpen] = useState(false)
  const [thermalMode, setThermalMode] = useState<'site' | 'custom'>('site')
  const [selection, setSelection] = useState<Coordinate[]>([])
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [thermalLoading, setThermalLoading] = useState(false)
  const [thermalError, setThermalError] = useState<string | null>(null)
  const hasMapKey = Boolean(apiKey)
  const boundsCenter = useMemo(() => site.center, [site.center.lat, site.center.lng])

  thermalRef.current = thermal
  temperatureRef.current = temperatureC

  useEffect(() => {
    setThermal(null)
    setSelection([])
    setThermalError(null)
    workerInfoWindowRef.current?.close()
  }, [site.id])

  useEffect(() => {
    if (!hasMapKey || !containerRef.current) return
    let cancelled = false
    let polygon: google.maps.Polygon | null = null
    const markers: google.maps.Marker[] = []

    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !containerRef.current) return
      const map = new googleInstance.maps.Map(containerRef.current, {
        center: boundsCenter,
        zoom: 17,
        mapTypeId: mapType,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        backgroundColor: '#e4eaeb',
      })
      mapRef.current = map
      polygon = new googleInstance.maps.Polygon({
        paths: site.polygon,
        strokeColor: '#38d0c1',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#0b8b87',
        fillOpacity: 0.12,
        clickable: false,
        map,
        zIndex: 5,
      })
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 48)

      workers.forEach((worker) => {
        const marker = new googleInstance.maps.Marker({
          position: worker.coordinate,
          map,
          title: `${worker.name} — ${worker.risk} risk`,
          zIndex: 30,
          optimized: false,
          icon: {
            url: workerMarkerSvg(worker),
            scaledSize: new googleInstance.maps.Size(48, 58),
            anchor: new googleInstance.maps.Point(24, 52),
          },
        })

        marker.addListener('click', () => {
          thermalInfoWindowRef.current?.close()
          workerInfoWindowRef.current?.close()
          const activeThermal = thermalRef.current
          const tile = activeThermal?.dataStatus === 'verified'
            ? activeThermal.tiles.find((candidate) => pointInPolygon(worker.coordinate, candidate.polygon))
            : undefined
          const workerTemperature = tile?.temperatureC ?? temperatureRef.current
          const info = new googleInstance.maps.InfoWindow({
            content: workerPopupHtml(worker, workerTemperature),
            maxWidth: 292,
            ariaLabel: `${worker.name} exposure details`,
            pixelOffset: new googleInstance.maps.Size(0, -10),
          })
          info.addListener('domready', () => {
            const popup = document.querySelector(`[data-worker-popup="${worker.id}"]`)
            if (!popup) return

            popup.querySelector('[data-action="view"]')?.addEventListener('click', () => {
              window.location.assign(`/plan?site=${encodeURIComponent(site.id)}&worker=${encodeURIComponent(worker.id)}`)
            })
            popup.querySelector('[data-action="adjust"]')?.addEventListener('click', () => {
              window.location.assign(`/plan?site=${encodeURIComponent(site.id)}&worker=${encodeURIComponent(worker.id)}&mode=adjust`)
            })

            requestAnimationFrame(() => {
              keepPopupInsideMap(map, popup)
              window.setTimeout(() => keepPopupInsideMap(map, popup), 120)
            })
          })
          info.open({ map, anchor: marker, shouldFocus: false })
          workerInfoWindowRef.current = info
        })
        markers.push(marker)
      })
      setMapVersion((value) => value + 1)
    }).catch((error: Error) => { if (!cancelled) setMapError(error.message) })

    return () => {
      cancelled = true
      workerInfoWindowRef.current?.close()
      polygon?.setMap(null)
      markers.forEach((marker) => marker.setMap(null))
      mapRef.current = null
    }
  }, [boundsCenter, hasMapKey, mapType, site.id, site.polygon, workers])

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
    thermalClickListenerRef.current?.remove()
    thermalClickListenerRef.current = null
    thermalInfoWindowRef.current?.close()
    thermalInfoWindowRef.current = null
    thermalOverlayRef.current?.setMap(null)
    thermalOverlayRef.current = null

    const map = mapRef.current
    if (!map || thermal?.dataStatus !== 'verified' || !window.google?.maps) return
    const min = thermal.minTemperatureC ?? 0
    const max = thermal.maxTemperatureC ?? min
    const tiles = thermal.tiles
    const sitePolygon = site.polygon
    const hottestTileId = thermal.hottestTileId

    class ThermalCanvasOverlay extends google.maps.OverlayView {
      private canvas: HTMLCanvasElement | null = null

      onAdd() {
        const canvas = document.createElement('canvas')
        canvas.className = 'thermal-canvas-overlay'
        canvas.style.position = 'absolute'
        canvas.style.pointerEvents = 'none'
        this.canvas = canvas
        this.getPanes()?.overlayLayer.appendChild(canvas)
      }

      draw() {
        const canvas = this.canvas
        const projection = this.getProjection()
        const mapBounds = mapRef.current?.getBounds()
        if (!canvas || !projection || !mapBounds) return

        const northEast = projection.fromLatLngToDivPixel(mapBounds.getNorthEast())
        const southWest = projection.fromLatLngToDivPixel(mapBounds.getSouthWest())
        if (!northEast || !southWest) return

        const left = Math.floor(southWest.x)
        const top = Math.floor(northEast.y)
        const width = Math.max(1, Math.ceil(northEast.x - southWest.x))
        const height = Math.max(1, Math.ceil(southWest.y - northEast.y))
        const dpr = Math.max(1, window.devicePixelRatio || 1)

        canvas.style.left = `${left}px`
        canvas.style.top = `${top}px`
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)

        const context = canvas.getContext('2d')
        if (!context) return
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.clearRect(0, 0, width, height)

        const project = (point: Coordinate) => {
          const pixel = projection.fromLatLngToDivPixel(new google.maps.LatLng(point.lat, point.lng))
          return pixel ? { x: pixel.x - left, y: pixel.y - top } : null
        }

        context.save()
        context.beginPath()
        sitePolygon.forEach((point, index) => {
          const pixel = project(point)
          if (!pixel) return
          if (index === 0) context.moveTo(pixel.x, pixel.y)
          else context.lineTo(pixel.x, pixel.y)
        })
        context.closePath()
        context.clip()

        tiles.forEach((tile) => {
          const points = tile.polygon.map(project).filter((point): point is { x: number; y: number } => Boolean(point))
          if (points.length < 3) return
          context.beginPath()
          points.forEach((point, index) => {
            if (index === 0) context.moveTo(point.x, point.y)
            else context.lineTo(point.x, point.y)
          })
          context.closePath()
          context.globalAlpha = 0.58
          context.fillStyle = heatColor(tile.temperatureC, min, max)
          context.fill()
          context.globalAlpha = 0.8
          context.strokeStyle = heatColor(tile.temperatureC, min, max)
          context.lineWidth = tile.id === hottestTileId ? 2.4 : 1
          context.stroke()
        })
        context.restore()
        context.globalAlpha = 1
      }

      onRemove() {
        this.canvas?.remove()
        this.canvas = null
      }
    }

    const overlay = new ThermalCanvasOverlay()
    overlay.setMap(map)
    thermalOverlayRef.current = overlay

    if (thermalMode !== 'custom') {
      thermalClickListenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        if (!pointInPolygon(point, sitePolygon)) return
        const tile = tiles.find((candidate) => pointInPolygon(point, candidate.polygon))
        if (!tile) return

        workerInfoWindowRef.current?.close()
        thermalInfoWindowRef.current?.close()
        const info = new google.maps.InfoWindow({
          content: `<div class="thermal-cell-popup"><strong>${tile.temperatureC.toFixed(1)}°C</strong><span>${temperatureBand(tile.temperatureC, min, max)}</span><small>FortyGuard thermal cell • clipped to site boundary</small></div>`,
          position: event.latLng,
          maxWidth: 210,
        })
        info.open({ map })
        thermalInfoWindowRef.current = info
      })
    }

    return () => {
      thermalClickListenerRef.current?.remove()
      thermalClickListenerRef.current = null
      thermalInfoWindowRef.current?.close()
      thermalInfoWindowRef.current = null
      overlay.setMap(null)
      thermalOverlayRef.current = null
    }
  }, [mapVersion, site.polygon, thermal, thermalMode])

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
            <select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value) as Granularity); setThermal(null) }}>
              <option value={60}>60 m · detailed</option>
              <option value={80}>80 m · balanced</option>
              <option value={100}>100 m · efficient</option>
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
              <div><span>Warmest</span><strong>{thermal.maxTemperatureC?.toFixed(1)}°C</strong></div>
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
          <span>Cooler</span><i className="thermal-legend__scale" /><span>Warmer</span>
          <strong>{thermal.minTemperatureC?.toFixed(1)}°C — {thermal.maxTemperatureC?.toFixed(1)}°C</strong>
        </div>
      )}

      <div className="site-map-card__controls" aria-label="Map controls">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in"><Plus size={18} /></button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out"><Minus size={18} /></button>
        <button type="button" onClick={recenter} aria-label="Recenter map"><LocateFixed size={18} /></button>
        <button type="button" onClick={toggleLayers} aria-label="Toggle map layer"><Layers3 size={18} /></button>
        {(thermal || selection.length > 0) && <button type="button" onClick={clearThermal} aria-label="Clear thermal layer" title="Clear thermal layer"><RotateCcw size={17} /></button>}
      </div>
      {!workers.length && <div className="site-map-worker-empty">0 workers assigned to this site</div>}
      {mapError && <div className="site-map-card__error">{mapError}</div>}
      <div className="site-map-card__google-label">Google</div>
    </section>
  )
}
