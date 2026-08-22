import { Layers3, LocateFixed, Minus, Plus, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Site, Worker } from '../../types/site'

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
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const hasMapKey = Boolean(apiKey)
  const boundsCenter = useMemo(() => site.center, [site.center.lat, site.center.lng])

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
      polygon = new googleInstance.maps.Polygon({ paths: site.polygon, strokeColor: '#38d0c1', strokeOpacity: 1, strokeWeight: 3, fillColor: '#0b8b87', fillOpacity: 0.28, map })
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 48)

      workers.forEach((worker) => {
        const marker = new googleInstance.maps.Marker({
          position: worker.coordinate, map, title: `${worker.name} — ${worker.risk} risk`,
          icon: { path: googleInstance.maps.SymbolPath.CIRCLE, fillColor: markerColor(worker.risk), fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3, scale: 11 },
        })
        const info = new googleInstance.maps.InfoWindow({ content: `<strong>${worker.name}</strong><br/>${worker.role}<br/>${worker.location}` })
        marker.addListener('click', () => info.open({ map, anchor: marker }))
        markers.push(marker); infoWindows.push(info)
      })
    }).catch((error: Error) => { if (!cancelled) setMapError(error.message) })

    return () => {
      cancelled = true; polygon?.setMap(null); markers.forEach((marker) => marker.setMap(null)); infoWindows.forEach((info) => info.close()); mapRef.current = null
    }
  }, [boundsCenter, hasMapKey, mapType, site.polygon, workers])

  const zoom = (delta: number) => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 17) + delta)
  const recenter = () => { mapRef.current?.panTo(site.center); mapRef.current?.setZoom(17) }
  const toggleLayers = () => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')

  return (
    <section className="site-map-card panel">
      <div className="site-map-card__site-chip"><div><strong>{site.name}</strong><span>{site.address}</span></div><span className="status-pill status-pill--active">Active</span></div>
      {temperatureC != null ? <div className="site-map-card__weather-chip"><span className="sun-symbol">☀</span><span><strong>{temperatureC.toFixed(1)}°C</strong><small>{weatherLabel ?? 'Live'}</small></span></div> : <div className="site-map-card__weather-chip site-map-card__weather-chip--pending"><span>Live data pending</span></div>}
      <div className="site-map-card__canvas">{hasMapKey && !mapError ? <div ref={containerRef} className="site-map__google" /> : <MapFallback site={site} workers={workers} />}</div>
      <div className="site-map-card__controls" aria-label="Map controls">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in"><Plus size={18} /></button><button type="button" onClick={() => zoom(-1)} aria-label="Zoom out"><Minus size={18} /></button><button type="button" onClick={recenter} aria-label="Recenter map"><LocateFixed size={18} /></button><button type="button" onClick={toggleLayers} aria-label="Toggle map layer"><Layers3 size={18} /></button>
      </div>
      {!workers.length && <div className="site-map-worker-empty">0 workers assigned to this site</div>}
      {mapError && <div className="site-map-card__error">{mapError}</div>}
      <div className="site-map-card__google-label">Google</div>
    </section>
  )
}
