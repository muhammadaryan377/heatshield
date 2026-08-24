import { Crosshair, Layers3, MapPin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { EnterpriseAssetExposure } from '../../types/asset'
import type { Coordinate, Site, ThermalMapResponse } from '../../types/site'

interface EnterpriseAssetMapProps {
  site: Site
  exposures: EnterpriseAssetExposure[]
  thermal: ThermalMapResponse | null
  selectedAssetId: string | null
  placementMode: boolean
  pendingCoordinate: Coordinate | null
  onSelectAsset: (assetId: string) => void
  onPickCoordinate: (coordinate: Coordinate) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.18) return '#188e8b'
  if (ratio < 0.38) return '#63ad68'
  if (ratio < 0.58) return '#d6bf42'
  if (ratio < 0.78) return '#ec8a2e'
  return '#dc4a45'
}

function assetColor(exposure: EnterpriseAssetExposure) {
  if (exposure.riskBand === 'critical') return '#c8323e'
  if (exposure.riskBand === 'high') return '#e16b32'
  if (exposure.riskBand === 'medium') return '#c59622'
  if (exposure.riskBand === 'low') return '#168a83'
  return '#68777c'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function EnterpriseAssetMap({
  site,
  exposures,
  thermal,
  selectedAssetId,
  placementMode,
  pendingCoordinate,
  onSelectAsset,
  onPickCoordinate,
}: EnterpriseAssetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const sitePolygonRef = useRef<google.maps.Polygon | null>(null)
  const heatRef = useRef<google.maps.Polygon[]>([])
  const markersRef = useRef<google.maps.Marker[]>([])
  const draftMarkerRef = useRef<google.maps.Marker | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const onPickCoordinateRef = useRef(onPickCoordinate)
  const onSelectAssetRef = useRef(onSelectAsset)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

  useEffect(() => {
    onPickCoordinateRef.current = onPickCoordinate
  }, [onPickCoordinate])

  useEffect(() => {
    onSelectAssetRef.current = onSelectAsset
  }, [onSelectAsset])

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false

    loadGoogleMaps(apiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return
        setMapError(null)
        const map = new googleInstance.maps.Map(containerRef.current, {
          center: site.center,
          zoom: 17,
          mapTypeId: mapType,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#dce4e5',
        })
        mapRef.current = map

        sitePolygonRef.current = new googleInstance.maps.Polygon({
          map,
          paths: site.polygon,
          strokeColor: '#12a29c',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0b8b87',
          fillOpacity: 0.035,
          clickable: false,
          zIndex: 30,
        })

        const bounds = new googleInstance.maps.LatLngBounds()
        site.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 42)

        map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return
          onPickCoordinateRef.current({ lat: event.latLng.lat(), lng: event.latLng.lng() })
        })
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      infoRef.current?.close()
      infoRef.current = null
      heatRef.current.forEach((polygon) => polygon.setMap(null))
      markersRef.current.forEach((marker) => marker.setMap(null))
      draftMarkerRef.current?.setMap(null)
      sitePolygonRef.current?.setMap(null)
      heatRef.current = []
      markersRef.current = []
      draftMarkerRef.current = null
      sitePolygonRef.current = null
      mapRef.current = null
    }
  }, [site.id, site.center.lat, site.center.lng, site.polygon, mapType])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return

    heatRef.current.forEach((polygon) => polygon.setMap(null))
    markersRef.current.forEach((marker) => marker.setMap(null))
    heatRef.current = []
    markersRef.current = []

    if (thermal?.dataStatus === 'verified' && thermal.tiles.length) {
      const min = thermal.minTemperatureC ?? Math.min(...thermal.tiles.map((tile) => tile.temperatureC))
      const max = thermal.maxTemperatureC ?? Math.max(...thermal.tiles.map((tile) => tile.temperatureC))
      heatRef.current = thermal.tiles.map((tile) => {
        const color = heatColor(tile.temperatureC, min, max)
        return new google.maps.Polygon({
          map,
          paths: tile.polygon,
          strokeColor: color,
          strokeOpacity: 0.7,
          strokeWeight: 0.8,
          fillColor: color,
          fillOpacity: 0.45,
          clickable: false,
          zIndex: 10,
        })
      })
    }

    markersRef.current = exposures.map((exposure) => {
      const selected = exposure.asset.id === selectedAssetId
      const marker = new google.maps.Marker({
        map,
        position: exposure.asset.coordinate,
        title: exposure.asset.name,
        zIndex: selected ? 90 : 60,
        label: {
          text: exposure.asset.assetCode.slice(0, 4).toUpperCase(),
          color: '#ffffff',
          fontSize: '9px',
          fontWeight: '800',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: selected ? 17 : 14,
          fillColor: assetColor(exposure),
          fillOpacity: 0.98,
          strokeColor: '#ffffff',
          strokeWeight: selected ? 4 : 3,
        },
      })
      marker.addListener('click', () => {
        onSelectAssetRef.current(exposure.asset.id)
        infoRef.current?.close()
        const temperature = exposure.latestTemperatureC == null ? 'No matched thermal cell' : `${exposure.latestTemperatureC.toFixed(1)}°C latest surface`
        const persistence = exposure.persistenceHours == null ? 'Persistence unavailable' : `${exposure.persistenceHours.toFixed(1)} h persistence`
        const info = new google.maps.InfoWindow({
          content: `<div class="asset-map-popup"><strong>${escapeHtml(exposure.asset.name)}</strong><span>${escapeHtml(exposure.asset.assetCode)} · ${escapeHtml(exposure.asset.type.replaceAll('_', ' '))}</span><small>${escapeHtml(temperature)} · ${escapeHtml(persistence)}</small></div>`,
          maxWidth: 240,
        })
        info.open({ map, anchor: marker, shouldFocus: false })
        infoRef.current = info
      })
      return marker
    })
  }, [exposures, mapVersion, selectedAssetId, thermal])

  useEffect(() => {
    draftMarkerRef.current?.setMap(null)
    draftMarkerRef.current = null
    const map = mapRef.current
    if (!map || !pendingCoordinate || !placementMode || !window.google?.maps) return
    draftMarkerRef.current = new google.maps.Marker({
      map,
      position: pendingCoordinate,
      zIndex: 120,
      title: 'New asset position',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#0b8b87',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 4,
      },
    })
  }, [mapVersion, pendingCoordinate, placementMode])

  const recenter = () => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return
    const bounds = new google.maps.LatLngBounds()
    site.polygon.forEach((point) => bounds.extend(point))
    if (!bounds.isEmpty()) map.fitBounds(bounds, 42)
  }

  return (
    <section className={`enterprise-asset-map panel${placementMode ? ' enterprise-asset-map--placing' : ''}`}>
      <div className="enterprise-asset-map__head">
        <div>
          <span>THERMAL + INFRASTRUCTURE MAP</span>
          <h2>{site.name}</h2>
          <p>{placementMode ? 'Placement mode active — click inside the saved site boundary to position the new asset.' : 'Latest verified FortyGuard surface cells are overlaid behind registered enterprise assets.'}</p>
        </div>
        <div className="enterprise-asset-map__actions">
          <button type="button" onClick={recenter}><Crosshair size={15} /> Recenter</button>
          <button type="button" onClick={() => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')}><Layers3 size={15} /> {mapType === 'satellite' ? 'Road map' : 'Satellite'}</button>
        </div>
      </div>

      <div className="enterprise-asset-map__canvas">
        {apiKey && !mapError ? <div ref={containerRef} className="enterprise-asset-map__google" /> : (
          <div className="enterprise-asset-map__fallback">
            <MapPin size={24} />
            <strong>Map preview unavailable</strong>
            <span>{mapError ?? 'Add VITE_GOOGLE_MAPS_API_KEY to place and inspect enterprise assets spatially.'}</span>
          </div>
        )}

        <div className="enterprise-asset-map__legend">
          <div><strong>Surface temperature</strong><span>{thermal?.dataStatus === 'verified' ? `${thermal.tileCount} verified cells` : 'Evidence unavailable'}</span></div>
          <i className="enterprise-asset-map__gradient" />
          <div className="enterprise-asset-map__risk-key"><span><b className="low" /> Low</span><span><b className="medium" /> Medium</span><span><b className="high" /> High</span><span><b className="critical" /> Critical</span></div>
        </div>
      </div>
    </section>
  )
}
