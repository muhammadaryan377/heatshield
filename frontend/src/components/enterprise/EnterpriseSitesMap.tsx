import { Layers3, LocateFixed, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Site, ThermalMapResponse } from '../../types/site'

interface EnterpriseSitesMapProps {
  sites: Site[]
  selectedSiteId: string | null
  thermal: ThermalMapResponse | null
  onSelectSite: (siteId: string) => void
}

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.18) return '#209d98'
  if (ratio < 0.36) return '#72b86c'
  if (ratio < 0.54) return '#d6c84d'
  if (ratio < 0.72) return '#f3a52c'
  if (ratio < 0.88) return '#ef6a35'
  return '#d84148'
}

export function EnterpriseSitesMap({ sites, selectedSiteId, thermal, onSelectSite }: EnterpriseSitesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonsRef = useRef<google.maps.Polygon[]>([])
  const markersRef = useRef<google.maps.Marker[]>([])
  const thermalPolygonsRef = useRef<google.maps.Polygon[]>([])
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId) ?? null, [selectedSiteId, sites])
  const hasMapKey = Boolean(mapsApiKey)

  useEffect(() => {
    if (!hasMapKey || !containerRef.current) return
    let cancelled = false
    setMapError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return
        const map = new googleInstance.maps.Map(containerRef.current, {
          center: selectedSite?.center ?? sites[0]?.center ?? { lat: 39.5, lng: -98.35 },
          zoom: selectedSite ? 16 : 4,
          mapTypeId: mapType,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#dce5e5',
        })
        mapRef.current = map
        setMapReady(true)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      setMapReady(false)
      polygonsRef.current.forEach((polygon) => polygon.setMap(null))
      markersRef.current.forEach((marker) => marker.setMap(null))
      thermalPolygonsRef.current.forEach((polygon) => polygon.setMap(null))
      polygonsRef.current = []
      markersRef.current = []
      thermalPolygonsRef.current = []
      mapRef.current = null
    }
  }, [hasMapKey])

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapType)
  }, [mapType])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !window.google?.maps) return

    polygonsRef.current.forEach((polygon) => polygon.setMap(null))
    markersRef.current.forEach((marker) => marker.setMap(null))
    polygonsRef.current = []
    markersRef.current = []

    const allBounds = new google.maps.LatLngBounds()

    sites.forEach((site) => {
      const selected = site.id === selectedSiteId
      site.polygon.forEach((point) => allBounds.extend(point))
      allBounds.extend(site.center)

      if (site.polygon.length >= 3) {
        const polygon = new google.maps.Polygon({
          map,
          paths: site.polygon,
          strokeColor: selected ? '#2fd0c1' : '#2f8583',
          strokeOpacity: selected ? 1 : 0.78,
          strokeWeight: selected ? 3 : 1.7,
          fillColor: selected ? '#0b8b87' : '#5b8e8c',
          fillOpacity: selected ? 0.14 : 0.08,
          clickable: true,
          zIndex: selected ? 20 : 8,
        })
        polygon.addListener('click', () => onSelectSite(site.id))
        polygonsRef.current.push(polygon)
      }

      const marker = new google.maps.Marker({
        map,
        position: site.center,
        title: site.name,
        zIndex: selected ? 40 : 25,
        label: selected ? {
          text: '✓',
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: '800',
        } : undefined,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: selected ? 10 : 8,
          fillColor: selected ? '#0b8b87' : '#ffffff',
          fillOpacity: 1,
          strokeColor: selected ? '#ffffff' : '#0b8b87',
          strokeWeight: 3,
        },
      })
      marker.addListener('click', () => onSelectSite(site.id))
      markersRef.current.push(marker)
    })

    if (selectedSite) {
      const bounds = new google.maps.LatLngBounds()
      if (selectedSite.polygon.length >= 3) selectedSite.polygon.forEach((point) => bounds.extend(point))
      else bounds.extend(selectedSite.center)
      if (!bounds.isEmpty()) map.fitBounds(bounds, 44)
    } else if (!allBounds.isEmpty()) {
      map.fitBounds(allBounds, 52)
    }
  }, [mapReady, onSelectSite, selectedSite, selectedSiteId, sites])

  useEffect(() => {
    thermalPolygonsRef.current.forEach((polygon) => polygon.setMap(null))
    thermalPolygonsRef.current = []
    const map = mapRef.current
    if (!map || !mapReady || thermal?.dataStatus !== 'verified' || !window.google?.maps) return

    const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
    const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))

    thermalPolygonsRef.current = thermal.tiles.map((tile) => {
      const color = heatColor(tile.temperatureC, min, max)
      return new google.maps.Polygon({
        map,
        paths: tile.polygon,
        strokeColor: color,
        strokeOpacity: 0.72,
        strokeWeight: tile.id === thermal.hottestTileId ? 2.1 : 0.7,
        fillColor: color,
        fillOpacity: 0.46,
        clickable: false,
        zIndex: 13,
      })
    })
  }, [mapReady, thermal])

  const recenter = () => {
    const map = mapRef.current
    if (!map) return
    if (selectedSite && window.google?.maps) {
      const bounds = new google.maps.LatLngBounds()
      if (selectedSite.polygon.length >= 3) selectedSite.polygon.forEach((point) => bounds.extend(point))
      else bounds.extend(selectedSite.center)
      map.fitBounds(bounds, 44)
      return
    }
    if (sites.length && window.google?.maps) {
      const bounds = new google.maps.LatLngBounds()
      sites.forEach((site) => {
        site.polygon.forEach((point) => bounds.extend(point))
        bounds.extend(site.center)
      })
      if (!bounds.isEmpty()) map.fitBounds(bounds, 52)
    }
  }

  return (
    <section className="enterprise-sites-map" aria-label="Enterprise site portfolio map">
      <div className="enterprise-sites-map__canvas">
        {hasMapKey && !mapError ? (
          <div ref={containerRef} className="enterprise-sites-map__google" />
        ) : (
          <div className="enterprise-sites-map__fallback">
            <div className="enterprise-sites-map__fallback-grid" />
            <strong>{mapError ?? 'Google Maps API key is not configured.'}</strong>
            <span>Site records and FortyGuard evidence still work; satellite portfolio visualization needs Google Maps.</span>
            <div className="enterprise-sites-map__fallback-sites">
              {sites.slice(0, 5).map((site) => (
                <button key={site.id} type="button" onClick={() => onSelectSite(site.id)} className={site.id === selectedSiteId ? 'active' : ''}>
                  <span /> {site.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="enterprise-sites-map__controls">
          <button type="button" onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 16) + 1)} aria-label="Zoom in"><Plus size={16} /></button>
          <button type="button" onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 16) - 1)} aria-label="Zoom out"><Minus size={16} /></button>
          <button type="button" onClick={recenter} aria-label="Recenter map"><LocateFixed size={16} /></button>
          <button type="button" onClick={() => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')} aria-label="Toggle map type"><Layers3 size={16} /></button>
        </div>

        <div className="enterprise-sites-map__legend">
          <strong>{selectedSite?.name ?? 'Enterprise portfolio'}</strong>
          <span>{thermal?.dataStatus === 'verified' ? `${thermal.tileCount} verified FortyGuard cells` : 'Site geometry view'}</span>
          {thermal?.dataStatus === 'verified' && <div className="enterprise-sites-map__thermal-scale" />}
        </div>
      </div>
    </section>
  )
}
