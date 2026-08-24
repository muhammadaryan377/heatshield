import { Crosshair, Layers3, MapPin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { PortfolioSiteAssessment } from '../../types/portfolio'

interface EnterprisePortfolioMapProps {
  assessments: PortfolioSiteAssessment[]
  selectedSiteId: string | null
  onSelectSite: (siteId: string) => void
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function riskColor(assessment: PortfolioSiteAssessment) {
  if (assessment.riskBand === 'critical') return '#c8323e'
  if (assessment.riskBand === 'high') return '#e16b32'
  if (assessment.riskBand === 'medium') return '#c59622'
  if (assessment.riskBand === 'low') return '#168a83'
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

function formatTemperature(value?: number | null) {
  return value == null ? 'No verified surface value' : `${value.toFixed(1)}°C peak surface`
}

export function EnterprisePortfolioMap({ assessments, selectedSiteId, onSelectSite }: EnterprisePortfolioMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const polygonsRef = useRef<google.maps.Polygon[]>([])
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapType, setMapType] = useState<'roadmap' | 'satellite'>('roadmap')
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapVersion, setMapVersion] = useState(0)

  useEffect(() => {
    if (!apiKey || !containerRef.current || !assessments.length) return
    let cancelled = false

    loadGoogleMaps(apiKey)
      .then((googleInstance) => {
        if (cancelled || !containerRef.current) return
        setMapError(null)
        const first = assessments[0].site.center
        const map = new googleInstance.maps.Map(containerRef.current, {
          center: first,
          zoom: 5,
          mapTypeId: mapType,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#e7edef',
        })
        mapRef.current = map
        const bounds = new googleInstance.maps.LatLngBounds()
        assessments.forEach(({ site }) => bounds.extend(site.center))
        if (assessments.length > 1 && !bounds.isEmpty()) map.fitBounds(bounds, 54)
        else if (assessments.length === 1) map.setZoom(15)
        setMapVersion((value) => value + 1)
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message)
      })

    return () => {
      cancelled = true
      infoRef.current?.close()
      markersRef.current.forEach((marker) => marker.setMap(null))
      polygonsRef.current.forEach((polygon) => polygon.setMap(null))
      markersRef.current = []
      polygonsRef.current = []
      mapRef.current = null
    }
  }, [assessments, mapType])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return

    markersRef.current.forEach((marker) => marker.setMap(null))
    polygonsRef.current.forEach((polygon) => polygon.setMap(null))
    markersRef.current = []
    polygonsRef.current = []

    assessments.forEach((assessment) => {
      const selected = assessment.site.id === selectedSiteId
      const color = riskColor(assessment)

      if (assessment.site.polygon.length >= 3) {
        const polygon = new google.maps.Polygon({
          map,
          paths: assessment.site.polygon,
          strokeColor: color,
          strokeOpacity: selected ? 1 : 0.72,
          strokeWeight: selected ? 3 : 2,
          fillColor: color,
          fillOpacity: selected ? 0.16 : 0.07,
          clickable: true,
          zIndex: selected ? 35 : 20,
        })
        polygon.addListener('click', () => onSelectSite(assessment.site.id))
        polygonsRef.current.push(polygon)
      }

      const marker = new google.maps.Marker({
        map,
        position: assessment.site.center,
        title: assessment.site.name,
        zIndex: selected ? 90 : 60,
        label: {
          text: assessment.riskScore == null ? '—' : String(assessment.riskScore),
          color: '#ffffff',
          fontSize: assessment.riskScore == null ? '12px' : '10px',
          fontWeight: '800',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: selected ? 19 : 16,
          fillColor: color,
          fillOpacity: 0.98,
          strokeColor: '#ffffff',
          strokeWeight: selected ? 4 : 3,
        },
      })

      marker.addListener('click', () => {
        onSelectSite(assessment.site.id)
        infoRef.current?.close()
        const risk = assessment.riskBand === 'unassessed'
          ? 'Unassessed'
          : `${assessment.riskBand.toUpperCase()} · ${assessment.riskScore ?? '—'}/100`
        const content = `<div style="min-width:210px"><strong>${escapeHtml(assessment.site.name)}</strong><br/><span>${escapeHtml(risk)}</span><br/><small>${escapeHtml(formatTemperature(assessment.peakTemperatureC))} · ${assessment.assetSummary.businessCritical} business-critical assets</small></div>`
        const info = new google.maps.InfoWindow({ content, maxWidth: 270 })
        info.open({ map, anchor: marker, shouldFocus: false })
        infoRef.current = info
      })
      markersRef.current.push(marker)
    })
  }, [assessments, mapVersion, onSelectSite, selectedSiteId])

  const recenter = () => {
    const map = mapRef.current
    if (!map || !window.google?.maps || !assessments.length) return
    const bounds = new google.maps.LatLngBounds()
    assessments.forEach(({ site }) => bounds.extend(site.center))
    if (assessments.length > 1 && !bounds.isEmpty()) map.fitBounds(bounds, 54)
    else {
      map.setCenter(assessments[0].site.center)
      map.setZoom(15)
    }
  }

  return (
    <section className="portfolio-map panel">
      <div className="portfolio-map__head">
        <div>
          <span>PORTFOLIO GEOGRAPHY</span>
          <h2>Portfolio Heat Map</h2>
          <p>Site markers show HeatShield portfolio risk derived from verified site evidence and registered enterprise context.</p>
        </div>
        <div className="portfolio-map__actions">
          <button type="button" onClick={recenter}><Crosshair size={15} /> Recenter</button>
          <button type="button" onClick={() => setMapType((current) => current === 'roadmap' ? 'satellite' : 'roadmap')}><Layers3 size={15} /> {mapType === 'roadmap' ? 'Satellite' : 'Road map'}</button>
        </div>
      </div>
      <div className="portfolio-map__canvas">
        {apiKey && !mapError && assessments.length ? <div ref={containerRef} className="portfolio-map__google" /> : (
          <div className="portfolio-map__fallback">
            <MapPin size={26} />
            <strong>Portfolio map unavailable</strong>
            <span>{!assessments.length ? 'Run portfolio assessment to map scored sites.' : mapError ?? 'Add VITE_GOOGLE_MAPS_API_KEY to visualize portfolio geography.'}</span>
          </div>
        )}
        <div className="portfolio-map__legend">
          <span><b className="low" /> Low</span>
          <span><b className="medium" /> Medium</span>
          <span><b className="high" /> High</span>
          <span><b className="critical" /> Critical</span>
          <span><b className="unassessed" /> Unassessed</span>
        </div>
      </div>
    </section>
  )
}
