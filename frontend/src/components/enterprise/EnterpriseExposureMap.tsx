import { Clock3, Flame, Layers3, LocateFixed, Minus, Plus, ThermometerSun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../../types/history'
import type { Coordinate, Site, ThermalMapResponse, ThermalTile } from '../../types/site'

export type ExposureMetric = 'temperature' | 'exceedance' | 'persistence' | 'peak'

interface EnterpriseExposureMapProps {
  site: Site
  thermal: ThermalMapResponse | null
  history: HistoricalHeatBehaviorResponse | null
  metric: ExposureMetric
  onMetricChange: (metric: ExposureMetric) => void
  analysisDate: string
}

interface DisplayCell {
  id: string
  polygon: Coordinate[]
  value: number
  detail: string
  source: string
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.18) return '#169c98'
  if (ratio < 0.36) return '#68b96d'
  if (ratio < 0.55) return '#d9c847'
  if (ratio < 0.74) return '#f0a132'
  if (ratio < 0.9) return '#ee6939'
  return '#d94745'
}

function metricTitle(metric: ExposureMetric) {
  if (metric === 'temperature') return 'Latest Surface Temperature'
  if (metric === 'exceedance') return 'Hours Above Threshold'
  if (metric === 'persistence') return 'Continuous Heat Persistence'
  return 'Time of Peak Heat'
}

function metricSource(metric: ExposureMetric, analysisDate: string) {
  if (metric === 'temperature') return 'Latest verified FortyGuard TCM spatial layer'
  return `FortyGuard ${metric === 'peak' ? 'time-of-measure' : metric} layer · ${analysisDate}`
}

function temperatureCells(thermal: ThermalMapResponse | null): DisplayCell[] {
  if (thermal?.dataStatus !== 'verified') return []
  return thermal.tiles.map((tile: ThermalTile) => ({
    id: tile.id,
    polygon: tile.polygon,
    value: tile.temperatureC,
    detail: `${tile.temperatureC.toFixed(1)}°C surface temperature`,
    source: 'Verified FortyGuard TCM cell',
  }))
}

function historicalCells(history: HistoricalHeatBehaviorResponse | null, metric: ExposureMetric): DisplayCell[] {
  if (!history || history.dataStatus === 'configuration_required' || history.dataStatus === 'unavailable') return []
  return history.cells.flatMap((cell: HistoricalHeatCell) => {
    if (metric === 'exceedance' && cell.exceedanceHours != null) {
      return [{
        id: cell.id,
        polygon: cell.polygon,
        value: cell.exceedanceHours,
        detail: `${cell.exceedanceHours.toFixed(1)} h above ${history.thresholdC.toFixed(1)}°C`,
        source: 'Verified FortyGuard exceedance cell',
      }]
    }
    if (metric === 'persistence' && cell.persistenceHours != null) {
      return [{
        id: cell.id,
        polygon: cell.polygon,
        value: cell.persistenceHours,
        detail: `${cell.persistenceHours.toFixed(1)} h longest continuous run`,
        source: 'Verified FortyGuard persistence cell',
      }]
    }
    if (metric === 'peak' && cell.peakHourUtc != null) {
      return [{
        id: cell.id,
        polygon: cell.polygon,
        value: cell.peakHourUtc,
        detail: cell.peakHourLocal ? `Peak heat around ${cell.peakHourLocal}` : `Peak hour ${cell.peakHourUtc}:00 UTC`,
        source: 'Verified FortyGuard time-of-measure cell',
      }]
    }
    return []
  })
}

function cellCenter(polygon: Coordinate[]) {
  if (!polygon.length) return null
  const usable = polygon.length > 1
    && polygon[0].lat === polygon[polygon.length - 1].lat
    && polygon[0].lng === polygon[polygon.length - 1].lng
    ? polygon.slice(0, -1)
    : polygon
  if (!usable.length) return null
  return {
    lat: usable.reduce((sum, point) => sum + point.lat, 0) / usable.length,
    lng: usable.reduce((sum, point) => sum + point.lng, 0) / usable.length,
  }
}

function formatObserved(value?: string | null) {
  if (!value) return 'No verified timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function EnterpriseExposureMap({ site, thermal, history, metric, onMetricChange, analysisDate }: EnterpriseExposureMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const boundaryRef = useRef<google.maps.Polygon | null>(null)
  const overlaysRef = useRef<google.maps.Polygon[]>([])
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

  const displayCells = useMemo(() => metric === 'temperature'
    ? temperatureCells(thermal)
    : historicalCells(history, metric), [history, metric, thermal])

  const values = useMemo(() => displayCells.map((cell) => cell.value), [displayCells])
  const min = metric === 'peak' ? 0 : values.length ? Math.min(...values) : 0
  const max = metric === 'peak' ? 23 : values.length ? Math.max(...values) : 1

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false
    setMapError(null)

    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !containerRef.current) return
      const map = new googleInstance.maps.Map(containerRef.current, {
        center: site.center,
        zoom: 17,
        mapTypeId: mapType,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        backgroundColor: '#dfe8e8',
      })
      mapRef.current = map

      boundaryRef.current = new googleInstance.maps.Polygon({
        map,
        paths: site.polygon,
        strokeColor: '#2fc2b7',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#0b8b87',
        fillOpacity: 0.025,
        clickable: false,
        zIndex: 30,
      })

      if (site.polygon.length >= 3) {
        const bounds = new googleInstance.maps.LatLngBounds()
        site.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 38)
      }
      setMapVersion((version) => version + 1)
    }).catch((error: Error) => {
      if (!cancelled) setMapError(error.message)
    })

    return () => {
      cancelled = true
      infoRef.current?.close()
      overlaysRef.current.forEach((overlay) => overlay.setMap(null))
      boundaryRef.current?.setMap(null)
      overlaysRef.current = []
      boundaryRef.current = null
      mapRef.current = null
    }
  }, [site.center.lat, site.center.lng, site.id, site.polygon])

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapType)
  }, [mapType])

  useEffect(() => {
    overlaysRef.current.forEach((overlay) => overlay.setMap(null))
    overlaysRef.current = []
    infoRef.current?.close()
    infoRef.current = null

    const map = mapRef.current
    if (!map || !window.google?.maps || !mapVersion) return

    overlaysRef.current = displayCells.map((cell) => {
      const color = heatColor(cell.value, min, max)
      const polygon = new google.maps.Polygon({
        map,
        paths: cell.polygon,
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.57,
        clickable: true,
        zIndex: 12,
      })

      polygon.addListener('click', (event: google.maps.PolyMouseEvent) => {
        infoRef.current?.close()
        const info = new google.maps.InfoWindow({
          position: event.latLng ?? cellCenter(cell.polygon) ?? site.center,
          maxWidth: 240,
          content: `<div class="enterprise-exposure-popup"><strong>${metricTitle(metric)}</strong><span>${cell.detail}</span><small>${cell.source}</small></div>`,
        })
        info.open({ map, shouldFocus: false })
        infoRef.current = info
      })
      return polygon
    })

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null))
      overlaysRef.current = []
      infoRef.current?.close()
      infoRef.current = null
    }
  }, [displayCells, mapVersion, max, metric, min, site.center])

  const recenter = () => {
    const map = mapRef.current
    if (!map) return
    if (site.polygon.length >= 3 && window.google?.maps) {
      const bounds = new google.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      map.fitBounds(bounds, 38)
      return
    }
    map.panTo(site.center)
  }

  const noDataMessage = metric === 'temperature'
    ? thermal?.message ?? 'No verified FortyGuard TCM cells are available for the latest spatial observation.'
    : history?.message ?? `No verified ${metric} cells are available for ${analysisDate}.`

  return (
    <section className="enterprise-exposure-map panel">
      <div className="enterprise-exposure-map__head">
        <div>
          <span className="enterprise-eyebrow">FORTYGUARD SPATIAL EVIDENCE</span>
          <h2>Property Exposure Map</h2>
          <p>{metricSource(metric, analysisDate)}</p>
        </div>
        <div className="enterprise-exposure-map__source">
          <span className={displayCells.length ? 'verified' : 'pending'} />
          <div><small>{displayCells.length ? 'VERIFIED LAYER' : 'LAYER UNAVAILABLE'}</small><strong>{displayCells.length ? `${displayCells.length} spatial cells` : 'No synthetic cells'}</strong></div>
        </div>
      </div>

      <div className="enterprise-exposure-map__tabs" role="group" aria-label="Property exposure metric">
        <button type="button" className={metric === 'temperature' ? 'active' : ''} onClick={() => onMetricChange('temperature')}><ThermometerSun size={15} /> Temperature <small>latest</small></button>
        <button type="button" className={metric === 'exceedance' ? 'active' : ''} onClick={() => onMetricChange('exceedance')}><Flame size={15} /> Exceedance</button>
        <button type="button" className={metric === 'persistence' ? 'active' : ''} onClick={() => onMetricChange('persistence')}><Flame size={15} /> Persistence</button>
        <button type="button" className={metric === 'peak' ? 'active' : ''} onClick={() => onMetricChange('peak')}><Clock3 size={15} /> Peak Time</button>
      </div>

      <div className="enterprise-exposure-map__canvas">
        {apiKey && !mapError ? <div ref={containerRef} className="enterprise-exposure-map__google" /> : (
          <div className="enterprise-exposure-map__fallback">
            <Layers3 size={28} />
            <strong>Map visualization unavailable</strong>
            <span>{mapError ?? 'Add VITE_GOOGLE_MAPS_API_KEY to render the spatial evidence.'}</span>
          </div>
        )}

        <div className="enterprise-exposure-map__controls">
          <button type="button" onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 17) + 1)} aria-label="Zoom in"><Plus size={17} /></button>
          <button type="button" onClick={() => mapRef.current?.setZoom((mapRef.current.getZoom() ?? 17) - 1)} aria-label="Zoom out"><Minus size={17} /></button>
          <button type="button" onClick={recenter} aria-label="Recenter site"><LocateFixed size={17} /></button>
          <button type="button" onClick={() => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')} aria-label="Toggle map type"><Layers3 size={17} /></button>
        </div>

        {!displayCells.length && (
          <div className="enterprise-exposure-map__empty">
            <strong>Verified layer unavailable</strong>
            <span>{noDataMessage}</span>
          </div>
        )}

        {displayCells.length > 0 && (
          <div className="enterprise-exposure-map__legend">
            <div><strong>{metricTitle(metric)}</strong><span>{metric === 'temperature' ? formatObserved(thermal?.observedAt) : analysisDate}</span></div>
            <i />
            <div className="enterprise-exposure-map__ticks">
              <span>{metric === 'temperature' ? `${min.toFixed(1)}°C` : metric === 'peak' ? '00:00' : `${min.toFixed(1)} h`}</span>
              <span>{metric === 'temperature' ? `${max.toFixed(1)}°C` : metric === 'peak' ? '23:00' : `${max.toFixed(1)} h`}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
