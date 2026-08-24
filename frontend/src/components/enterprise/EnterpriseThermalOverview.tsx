import { Layers3, LocateFixed, Minus, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Coordinate, Site, ThermalMapResponse } from '../../types/site'

interface EnterpriseThermalOverviewProps {
  site: Site
  thermal: ThermalMapResponse | null
  loading: boolean
  onRefresh: () => void
}

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.16) return '#1d9f9a'
  if (ratio < 0.34) return '#63b86d'
  if (ratio < 0.52) return '#d6c640'
  if (ratio < 0.7) return '#f2a329'
  if (ratio < 0.86) return '#ef6a32'
  return '#d93b42'
}

function tileCenter(polygon: Coordinate[]) {
  const points = polygon.length > 1 && polygon[0].lat === polygon[polygon.length - 1].lat && polygon[0].lng === polygon[polygon.length - 1].lng
    ? polygon.slice(0, -1)
    : polygon
  if (!points.length) return null
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function formatObservedAt(value?: string | null) {
  if (!value) return 'No verified spatial timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function EnterpriseThermalOverview({ site, thermal, loading, onRefresh }: EnterpriseThermalOverviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const tilePolygonsRef = useRef<google.maps.Polygon[]>([])
  const hotspotMarkersRef = useRef<google.maps.Marker[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')

  const hasMapKey = Boolean(mapsApiKey)
  const hottestTiles = useMemo(() => {
    if (thermal?.dataStatus !== 'verified') return []
    return [...thermal.tiles].sort((a, b) => b.temperatureC - a.temperatureC).slice(0, 4)
  }, [thermal])

  useEffect(() => {
    if (!hasMapKey || !containerRef.current) return
    let cancelled = false

    setMapError(null)
    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return

        const map = new googleInstance.maps.Map(containerRef.current, {
          center: site.center,
          zoom: 17,
          mapTypeId: mapType,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#dce5e5',
        })
        mapRef.current = map

        boundaryRef.current = new googleInstance.maps.Polygon({
          map,
          paths: site.polygon,
          strokeColor: '#35c6bb',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0b8b87',
          fillOpacity: 0.035,
          clickable: false,
          zIndex: 20,
        })

        if (site.polygon.length >= 3) {
          const bounds = new googleInstance.maps.LatLngBounds()
          site.polygon.forEach((point) => bounds.extend(point))
          if (!bounds.isEmpty()) map.fitBounds(bounds, 34)
        }
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      infoWindowRef.current?.close()
      infoWindowRef.current = null
      tilePolygonsRef.current.forEach((polygon) => polygon.setMap(null))
      hotspotMarkersRef.current.forEach((marker) => marker.setMap(null))
      tilePolygonsRef.current = []
      hotspotMarkersRef.current = []
      boundaryRef.current?.setMap(null)
      boundaryRef.current = null
      mapRef.current = null
    }
  }, [hasMapKey, site.center.lat, site.center.lng, site.id, site.polygon])

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapType)
  }, [mapType])

  useEffect(() => {
    tilePolygonsRef.current.forEach((polygon) => polygon.setMap(null))
    hotspotMarkersRef.current.forEach((marker) => marker.setMap(null))
    tilePolygonsRef.current = []
    hotspotMarkersRef.current = []
    infoWindowRef.current?.close()
    infoWindowRef.current = null

    const map = mapRef.current
    if (!map || thermal?.dataStatus !== 'verified' || !window.google?.maps) return

    const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
    const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))

    tilePolygonsRef.current = thermal.tiles.map((tile) => {
      const color = heatColor(tile.temperatureC, min, max)
      const polygon = new google.maps.Polygon({
        map,
        paths: tile.polygon,
        strokeColor: color,
        strokeOpacity: 0.88,
        strokeWeight: tile.id === thermal.hottestTileId ? 2.2 : 0.8,
        fillColor: color,
        fillOpacity: 0.53,
        zIndex: 10,
      })

      polygon.addListener('click', (event: google.maps.MapMouseEvent) => {
        infoWindowRef.current?.close()
        const info = new google.maps.InfoWindow({
          position: event.latLng ?? tileCenter(tile.polygon) ?? site.center,
          content: `<div class="enterprise-map-popup"><strong>${tile.temperatureC.toFixed(1)}°C</strong><span>Verified FortyGuard thermal cell</span><small>${thermal.granularityMeters} m analysis cell</small></div>`,
          maxWidth: 220,
        })
        info.open({ map, shouldFocus: false })
        infoWindowRef.current = info
      })
      return polygon
    })

    hotspotMarkersRef.current = hottestTiles.map((tile, index) => {
      const center = tileCenter(tile.polygon)
      if (!center) return null
      const marker = new google.maps.Marker({
        map,
        position: center,
        zIndex: 40 + (4 - index),
        title: `Hot zone ${index + 1}: ${tile.temperatureC.toFixed(1)}°C`,
        label: {
          text: `${tile.temperatureC.toFixed(1)}°`,
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: '700',
          className: 'enterprise-hotspot-marker-label',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: index === 0 ? 19 : 17,
          fillColor: index === 0 ? '#d93b42' : '#ef6338',
          fillOpacity: 0.94,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      })
      marker.addListener('click', () => {
        infoWindowRef.current?.close()
        const info = new google.maps.InfoWindow({
          position: center,
          content: `<div class="enterprise-map-popup"><strong>Hot zone ${index + 1}</strong><span>${tile.temperatureC.toFixed(1)}°C surface temperature</span><small>Verified FortyGuard cell</small></div>`,
          maxWidth: 220,
        })
        info.open({ map, shouldFocus: false })
        infoWindowRef.current = info
      })
      return marker
    }).filter((marker): marker is google.maps.Marker => Boolean(marker))
  }, [hottestTiles, site.center, thermal])

  const recenter = () => {
    const map = mapRef.current
    if (!map) return
    if (site.polygon.length >= 3 && window.google?.maps) {
      const bounds = new google.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      map.fitBounds(bounds, 34)
      return
    }
    map.panTo(site.center)
    map.setZoom(17)
  }

  const minTemperature = thermal?.dataStatus === 'verified' ? thermal.minTemperatureC : null
  const maxTemperature = thermal?.dataStatus === 'verified' ? thermal.maxTemperatureC : null

  return (
    <section className="enterprise-thermal-map" aria-label="Enterprise site thermal overview">
      <div className="enterprise-thermal-map__header">
        <div>
          <strong>Site Thermal Overview</strong>
          <span className={`enterprise-evidence-chip enterprise-evidence-chip--${thermal?.dataStatus === 'verified' ? 'verified' : 'pending'}`}>
            {thermal?.dataStatus === 'verified' ? 'FortyGuard spatial evidence' : loading ? 'Requesting spatial evidence' : 'Spatial evidence unavailable'}
          </span>
        </div>
        <button type="button" onClick={onRefresh} className="enterprise-map-refresh" disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          {loading ? 'Refreshing' : 'Refresh evidence'}
        </button>
      </div>

      <div className="enterprise-thermal-map__canvas">
        {hasMapKey && !mapError ? (
          <div ref={containerRef} className="enterprise-thermal-map__google" />
        ) : (
          <div className="enterprise-map-fallback">
            <div className="enterprise-map-fallback__grid" />
            <div className="enterprise-map-fallback__site">{site.name}</div>
            <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
            <span>The site evidence still loads, but the satellite visualization needs Google Maps.</span>
          </div>
        )}

        <div className="enterprise-map-controls" aria-label="Map controls">
          <button type="button" onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 17) + 1)} aria-label="Zoom in"><Plus size={17} /></button>
          <button type="button" onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 17) - 1)} aria-label="Zoom out"><Minus size={17} /></button>
          <button type="button" onClick={recenter} aria-label="Recenter site"><LocateFixed size={17} /></button>
          <button type="button" onClick={() => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')} aria-label="Toggle map type"><Layers3 size={17} /></button>
        </div>

        <aside className="enterprise-map-layers">
          <div className="enterprise-map-layers__title"><strong>Map Layers</strong><Layers3 size={15} /></div>
          <label><input type="radio" checked readOnly /> Surface temperature</label>
          <label className="enterprise-map-layers__disabled"><input type="radio" disabled /> Heat persistence <small>Exposure screen</small></label>
          <label className="enterprise-map-layers__disabled"><input type="radio" disabled /> Exceedance <small>Exposure screen</small></label>
          <div className="enterprise-map-layers__divider" />
          <label><input type="checkbox" checked readOnly /> Site boundary</label>
          <label><input type="checkbox" checked={hottestTiles.length > 0} readOnly /> Hotspot labels</label>
        </aside>

        <div className="enterprise-map-legend">
          <div className="enterprise-map-legend__row"><strong>Surface Temp</strong><span>{thermal?.granularityMeters ? `${thermal.granularityMeters} m cells` : 'FortyGuard layer'}</span></div>
          <div className="enterprise-map-legend__gradient" />
          <div className="enterprise-map-legend__ticks">
            <span>{minTemperature == null ? 'cool' : `${minTemperature.toFixed(1)}°C`}</span>
            <span>{maxTemperature == null ? 'hot' : `${maxTemperature.toFixed(1)}°C`}</span>
          </div>
        </div>

        {loading && (
          <div className="enterprise-map-state enterprise-map-state--loading">
            <RefreshCw size={18} className="spin" />
            <div><strong>Requesting FortyGuard spatial evidence</strong><span>HeatShield will not draw synthetic provider cells.</span></div>
          </div>
        )}

        {!loading && thermal?.dataStatus !== 'verified' && (
          <div className="enterprise-map-state">
            <strong>Verified spatial layer not available</strong>
            <span>{thermal?.message ?? 'Refresh the evidence when FortyGuard data is available.'}</span>
          </div>
        )}

        {thermal?.dataStatus === 'verified' && (
          <div className="enterprise-map-observed">
            <span className="enterprise-map-observed__dot" />
            <strong>{thermal.tileCount} verified cells</strong>
            <span>{formatObservedAt(thermal.observedAt)}</span>
          </div>
        )}
      </div>
    </section>
  )
}
