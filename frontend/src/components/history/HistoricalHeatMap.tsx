import { Clock3, Flame, Layers3, ThermometerSun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { HistoricalHeatBehaviorResponse, HistoricalHeatCell } from '../../types/history'
import type { Site } from '../../types/site'

type Metric = 'temperature' | 'exceedance' | 'persistence' | 'peak'

interface HistoricalHeatMapProps {
  site: Site
  result: HistoricalHeatBehaviorResponse
  metric: Metric
  onMetricChange: (metric: Metric) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function cellValue(cell: HistoricalHeatCell, metric: Metric) {
  if (metric === 'temperature') return cell.temperatureC ?? null
  if (metric === 'exceedance') return cell.exceedanceHours ?? null
  if (metric === 'persistence') return cell.persistenceHours ?? null
  return cell.peakHourUtc ?? null
}

function heatColor(value: number, min: number, max: number) {
  const span = Math.max(max - min, 0.01)
  const ratio = Math.max(0, Math.min(1, (value - min) / span))
  if (ratio < 0.2) return '#15938f'
  if (ratio < 0.4) return '#67b66c'
  if (ratio < 0.6) return '#e0c44e'
  if (ratio < 0.8) return '#ed8a32'
  return '#dc4d45'
}

function metricLabel(metric: Metric) {
  if (metric === 'temperature') return 'Historical temperature'
  if (metric === 'exceedance') return 'Heat exceedance'
  if (metric === 'persistence') return 'Heat persistence'
  return 'Peak-time behavior'
}

function cellDetail(cell: HistoricalHeatCell, metric: Metric) {
  if (metric === 'temperature') return cell.temperatureC == null ? 'No temperature value' : `${cell.temperatureC.toFixed(1)}°C provider temperature value`
  if (metric === 'exceedance') return cell.exceedanceHours == null ? 'No exceedance value' : `${cell.exceedanceHours.toFixed(1)} hours above threshold`
  if (metric === 'persistence') return cell.persistenceHours == null ? 'No persistence value' : `${cell.persistenceHours.toFixed(1)} hour longest continuous run`
  return cell.peakHourLocal ? `Peak hour ${cell.peakHourLocal}` : 'No peak-hour value'
}

function legendLabel(metric: Metric) {
  if (metric === 'temperature') return 'FortyGuard temperature value by historical cell'
  if (metric === 'exceedance') return 'Accumulated hours above selected threshold'
  if (metric === 'persistence') return 'Longest continuous hours above threshold'
  return 'Local peak hour by cell'
}

export function HistoricalHeatMap({ site, result, metric, onMetricChange }: HistoricalHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<google.maps.Polygon[]>([])
  const infoRef = useRef<google.maps.InfoWindow[]>([])
  const zoneMarkersRef = useRef<google.maps.Marker[]>([])
  const sitePolygonRef = useRef<google.maps.Polygon | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [mapVersion, setMapVersion] = useState(0)

  const metricValues = useMemo(() => result.cells
    .map((cell) => cellValue(cell, metric))
    .filter((value): value is number => value != null), [metric, result.cells])
  const min = metric === 'peak' ? 0 : metricValues.length ? Math.min(...metricValues) : 0
  const max = metric === 'peak' ? 23 : metricValues.length ? Math.max(...metricValues) : 1

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false

    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !containerRef.current) return
      setMapError(null)
      const map = new googleInstance.maps.Map(containerRef.current, {
        center: site.center,
        zoom: 16,
        mapTypeId: mapType,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        backgroundColor: '#e4eaeb',
      })
      mapRef.current = map
      const bounds = new googleInstance.maps.LatLngBounds()
      site.polygon.forEach((point) => bounds.extend(point))
      if (!bounds.isEmpty()) map.fitBounds(bounds, 42)

      sitePolygonRef.current = new googleInstance.maps.Polygon({
        map,
        paths: site.polygon,
        strokeColor: '#0b8b87',
        strokeOpacity: 0.92,
        strokeWeight: 2.5,
        fillOpacity: 0,
        clickable: false,
        zIndex: 20,
      })
      setMapVersion((value) => value + 1)
    }).catch((error: Error) => { if (!cancelled) setMapError(error.message) })

    return () => {
      cancelled = true
      overlaysRef.current.forEach((polygon) => polygon.setMap(null))
      infoRef.current.forEach((info) => info.close())
      zoneMarkersRef.current.forEach((marker) => marker.setMap(null))
      sitePolygonRef.current?.setMap(null)
      overlaysRef.current = []
      infoRef.current = []
      zoneMarkersRef.current = []
      sitePolygonRef.current = null
      mapRef.current = null
    }
  }, [mapType, site.center.lat, site.center.lng, site.id, site.polygon])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return

    overlaysRef.current.forEach((polygon) => polygon.setMap(null))
    infoRef.current.forEach((info) => info.close())
    zoneMarkersRef.current.forEach((marker) => marker.setMap(null))
    overlaysRef.current = []
    infoRef.current = []
    zoneMarkersRef.current = []

    result.cells.forEach((cell) => {
      const value = cellValue(cell, metric)
      if (value == null || cell.polygon.length < 3) return
      const color = heatColor(value, min, max)
      const polygon = new google.maps.Polygon({
        map,
        paths: cell.polygon,
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.6,
        clickable: true,
        zIndex: 10,
      })
      const info = new google.maps.InfoWindow({
        content: `<div style="min-width:185px"><strong>${metricLabel(metric)}</strong><br/><span>${cellDetail(cell, metric)}</span><br/><small>FortyGuard historical cell · ${result.startDate} to ${result.endDate}</small></div>`,
      })
      polygon.addListener('click', (event: google.maps.PolyMouseEvent) => {
        infoRef.current.forEach((windowInfo) => windowInfo.close())
        if (event.latLng) info.setPosition(event.latLng)
        info.open({ map })
      })
      overlaysRef.current.push(polygon)
      infoRef.current.push(info)
    })

    site.zones.filter((zone) => zone.operationalApproved).forEach((zone) => {
      const sample = result.zones.find((item) => item.zoneId === zone.id)
      const marker = new google.maps.Marker({
        map,
        position: zone.center,
        title: zone.name,
        zIndex: 40,
        label: { text: zone.name.slice(0, 1).toUpperCase(), color: '#ffffff', fontWeight: '700' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#0b6f6b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale: 12,
        },
      })
      const detail = sample
        ? `${sample.temperatureC?.toFixed(1) ?? '—'}°C · ${sample.exceedanceHours?.toFixed(1) ?? '—'} h above threshold`
        : 'No matched historical cell'
      const info = new google.maps.InfoWindow({
        content: `<div style="min-width:195px"><strong>${zone.name}</strong><br/><span>${detail}</span><br/><small>Supervisor-approved operational zone</small></div>`,
      })
      marker.addListener('click', () => {
        infoRef.current.forEach((windowInfo) => windowInfo.close())
        info.open({ map, anchor: marker })
      })
      zoneMarkersRef.current.push(marker)
      infoRef.current.push(info)
    })
  }, [mapVersion, max, metric, min, result.cells, result.endDate, result.startDate, result.zones, site.zones])

  const hasMap = Boolean(apiKey) && !mapError

  return (
    <section className="history-map panel">
      <div className="history-map__head">
        <div>
          <span className="history-eyebrow">FORTYGUARD SPATIAL EVIDENCE</span>
          <h2>Where does this site store and repeat heat?</h2>
          <p>Switch between temperature, threshold exceedance, persistence and peak-time behavior. Every colored cell is returned by FortyGuard.</p>
        </div>
        <button type="button" className="history-layer-button" onClick={() => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')} disabled={!hasMap}>
          <Layers3 size={16} /> {mapType === 'satellite' ? 'Road map' : 'Satellite'}
        </button>
      </div>

      <div className="history-map__tabs" role="group" aria-label="Historical map layer">
        <button type="button" className={metric === 'temperature' ? 'active' : ''} onClick={() => onMetricChange('temperature')}><ThermometerSun size={15} /> Temperature</button>
        <button type="button" className={metric === 'exceedance' ? 'active' : ''} onClick={() => onMetricChange('exceedance')}><Flame size={15} /> Exceedance</button>
        <button type="button" className={metric === 'persistence' ? 'active' : ''} onClick={() => onMetricChange('persistence')}><Flame size={15} /> Persistence</button>
        <button type="button" className={metric === 'peak' ? 'active' : ''} onClick={() => onMetricChange('peak')}><Clock3 size={15} /> Peak Time</button>
      </div>

      <div className="history-map__canvas">
        {hasMap ? <div ref={containerRef} className="history-map__google" /> : (
          <div className="history-map__fallback">
            <MapFallbackMessage error={mapError} />
          </div>
        )}
      </div>

      <div className="history-map__legend">
        <span>{metric === 'peak' ? 'Earlier' : 'Lower'}</span><i /> <span>{metric === 'peak' ? 'Later' : 'Higher'}</span>
        <strong>{legendLabel(metric)}</strong>
      </div>
    </section>
  )
}

function MapFallbackMessage({ error }: { error: string | null }) {
  return <div><strong>Historical map preview unavailable</strong><span>{error ?? 'Add VITE_GOOGLE_MAPS_API_KEY to visualize FortyGuard spatial cells.'}</span></div>
}
