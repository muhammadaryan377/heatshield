import { Flame, Layers3, LoaderCircle, MapPinned, Satellite, ShieldCheck, UsersRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { Site, ThermalMapResponse, Worker } from '../../types/site'

interface Props {
  site: Site
  workers: Worker[]
}

type Layers = {
  workers: boolean
  zones: boolean
  heat: boolean
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function workerColor(risk: Worker['risk']) {
  if (risk === 'extreme') return '#dc3e3e'
  if (risk === 'high') return '#ef7f23'
  if (risk === 'medium') return '#dcae2c'
  return '#159b77'
}

function zoneColor(type: Site['zones'][number]['type']) {
  if (type === 'recovery') return '#1a9d66'
  if (type === 'restricted') return '#d84b45'
  if (type === 'roof') return '#8b65c4'
  if (type === 'staging') return '#327bbb'
  if (type === 'open-yard') return '#0b8b87'
  return '#6d7d82'
}

function heatColor(value: number, min: number, max: number) {
  const ratio = (value - min) / Math.max(max - min, 0.01)
  if (ratio >= .8) return '#df4d45'
  if (ratio >= .6) return '#ef8b2f'
  if (ratio >= .4) return '#e4c64f'
  if (ratio >= .2) return '#68b96d'
  return '#1c9a94'
}

function observedLabel(value?: string | null) {
  if (!value) return 'timestamp unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function SiteCommandMap({ site, workers }: Props) {
  const node = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<google.maps.Polygon | google.maps.Marker>>([])
  const infoRef = useRef<google.maps.InfoWindow[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [mapType, setMapType] = useState<'satellite' | 'roadmap'>('satellite')
  const [layers, setLayers] = useState<Layers>({ workers: true, zones: true, heat: false })
  const [thermal, setThermal] = useState<ThermalMapResponse | null>(null)
  const [thermalLoading, setThermalLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setThermal(null)
    setLayers((current) => ({ ...current, heat: false }))
    setMessage(null)
  }, [site.id])

  useEffect(() => {
    if (!apiKey || !node.current) return
    let cancelled = false
    loadGoogleMaps(apiKey).then((googleInstance) => {
      if (cancelled || !node.current) return
      const map = new googleInstance.maps.Map(node.current, {
        center: site.center,
        zoom: 17,
        mapTypeId: mapType,
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
      })
      mapRef.current = map
      setMapReady(true)
    }).catch((error: Error) => setMessage(error.message))
    return () => {
      cancelled = true
      setMapReady(false)
      overlaysRef.current.forEach((overlay) => overlay.setMap(null))
      infoRef.current.forEach((info) => info.close())
      overlaysRef.current = []
      infoRef.current = []
      mapRef.current = null
    }
  }, [site.id])

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapType)
  }, [mapType])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return
    overlaysRef.current.forEach((overlay) => overlay.setMap(null))
    infoRef.current.forEach((info) => info.close())
    overlaysRef.current = []
    infoRef.current = []
    const map = mapRef.current
    const bounds = new google.maps.LatLngBounds()

    if (layers.heat && thermal?.dataStatus === 'verified') {
      const min = thermal.minTemperatureC ?? 0
      const max = thermal.maxTemperatureC ?? min
      thermal.tiles.forEach((tile) => {
        const polygon = new google.maps.Polygon({
          map,
          paths: tile.polygon,
          strokeColor: heatColor(tile.temperatureC, min, max),
          strokeWeight: 1,
          strokeOpacity: .8,
          fillColor: heatColor(tile.temperatureC, min, max),
          fillOpacity: .48,
          zIndex: 1,
        })
        const info = new google.maps.InfoWindow({ content: `<strong>${tile.temperatureC.toFixed(1)}°C</strong><br/><small>FortyGuard thermal cell · ${observedLabel(thermal.observedAt)}</small>` })
        polygon.addListener('click', (event: google.maps.PolyMouseEvent) => {
          if (event.latLng) info.setPosition(event.latLng)
          info.open({ map })
        })
        overlaysRef.current.push(polygon)
        infoRef.current.push(info)
      })
    }

    const boundary = new google.maps.Polygon({
      map,
      paths: site.polygon,
      strokeColor: '#0b8b87',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#11a39b',
      fillOpacity: layers.heat ? .04 : .12,
      clickable: false,
      zIndex: 3,
    })
    overlaysRef.current.push(boundary)
    site.polygon.forEach((point) => bounds.extend(point))

    if (layers.zones) {
      site.zones.forEach((zone) => {
        const path = zone.polygon?.length >= 3 ? zone.polygon : []
        if (path.length >= 3) {
          const color = zoneColor(zone.type)
          const polygon = new google.maps.Polygon({
            map,
            paths: path,
            strokeColor: color,
            strokeOpacity: 1,
            strokeWeight: 2.5,
            fillColor: color,
            fillOpacity: zone.type === 'restricted' ? .2 : .14,
            zIndex: 5,
          })
          const info = new google.maps.InfoWindow({ content: `<strong>${zone.name}</strong><br/><small>${zone.type.replace('-', ' ')} · ${zone.operationalApproved ? 'approved' : 'not approved'}</small>` })
          polygon.addListener('click', (event: google.maps.PolyMouseEvent) => {
            if (event.latLng) info.setPosition(event.latLng)
            info.open({ map })
          })
          overlaysRef.current.push(polygon)
          infoRef.current.push(info)
        } else {
          const marker = new google.maps.Marker({
            map,
            position: zone.center,
            title: `${zone.name} · legacy point zone`,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: zoneColor(zone.type), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 9 },
            zIndex: 6,
          })
          overlaysRef.current.push(marker)
        }
      })
    }

    if (layers.workers) {
      workers.filter((worker) => worker.status !== 'offsite').forEach((worker) => {
        const marker = new google.maps.Marker({
          map,
          position: worker.coordinate,
          title: `${worker.name} · ${worker.role}`,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: workerColor(worker.risk), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale: 10 },
          zIndex: 10,
        })
        const info = new google.maps.InfoWindow({ content: `<strong>${worker.name}</strong><br/>${worker.role}<br/><small>${worker.task ?? worker.location} · ${worker.risk} risk</small>` })
        marker.addListener('click', () => info.open({ map, anchor: marker }))
        overlaysRef.current.push(marker)
        infoRef.current.push(info)
        bounds.extend(worker.coordinate)
      })
    }

    if (!bounds.isEmpty()) map.fitBounds(bounds, 58)
  }, [layers, mapReady, site, thermal, workers])

  const toggleHeat = async () => {
    if (layers.heat) {
      setLayers((current) => ({ ...current, heat: false }))
      return
    }
    if (thermal?.dataStatus === 'verified') {
      setLayers((current) => ({ ...current, heat: true }))
      setMessage(thermal.message ?? `FortyGuard layer verified at ${observedLabel(thermal.observedAt)}.`)
      return
    }
    setThermalLoading(true)
    setMessage('Requesting a real FortyGuard TCM layer for this saved site polygon…')
    try {
      const response = await api.generateThermalMap(site.id, { mode: 'site', granularityMeters: 100 })
      setThermal(response)
      setMessage(response.message ?? (response.dataStatus === 'verified' ? 'FortyGuard thermal layer verified.' : 'FortyGuard thermal cells are unavailable for this site.'))
      if (response.dataStatus === 'verified') setLayers((current) => ({ ...current, heat: true }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load FortyGuard heat layer.')
    } finally {
      setThermalLoading(false)
    }
  }

  const toggle = (key: 'workers' | 'zones') => setLayers((current) => ({ ...current, [key]: !current[key] }))

  return <section className="site-command-map panel">
    <div className="site-command-map__bar">
      <div><span className="sites-eyebrow">SPATIAL OPERATIONS · FORTYGUARD THERMAL CORE</span><h2>{site.name} map</h2></div>
      <div className="site-command-map__layers">
        <button type="button" className={layers.workers ? 'active' : ''} onClick={() => toggle('workers')}><UsersRound size={15}/> Workers</button>
        <button type="button" className={layers.zones ? 'active' : ''} onClick={() => toggle('zones')}><ShieldCheck size={15}/> Zones</button>
        <button type="button" className={layers.heat ? 'active' : ''} onClick={() => void toggleHeat()} disabled={thermalLoading}>{thermalLoading ? <LoaderCircle className="spin" size={15}/> : <Flame size={15}/>} FortyGuard Heat</button>
        <button type="button" className={mapType === 'satellite' ? 'active' : ''} onClick={() => setMapType((current) => current === 'satellite' ? 'roadmap' : 'satellite')}><Satellite size={15}/> {mapType === 'satellite' ? 'Satellite' : 'Road'}</button>
      </div>
    </div>
    <div className="site-command-map__canvas">{apiKey ? <div ref={node} className="site-command-map__google"/> : <div className="site-command-map__empty"><MapPinned size={28}/><strong>Google Maps key required</strong><span>Configure VITE_GOOGLE_MAPS_API_KEY for the operations map.</span></div>}</div>
    <div className="site-command-map__legend"><span><i className="legend-boundary"/> Site boundary</span><span><i className="legend-worker"/> Worker</span><span><i className="legend-zone"/> Operational zone</span>{thermal?.dataStatus === 'verified' && <span><Flame size={14}/> FortyGuard · {thermal.tileCount} cells · {observedLabel(thermal.observedAt)}</span>}<span><Layers3 size={14}/> Click workers, zones and heat cells for details</span></div>
    {message && <div className="site-command-map__message">{message}</div>}
  </section>
}
