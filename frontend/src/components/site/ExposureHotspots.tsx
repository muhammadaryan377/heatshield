import { MapPinned } from 'lucide-react'
import type { HeatSpot } from '../../types/site'

interface ExposureHotspotsProps {
  hotspots: HeatSpot[]
}

function color(level: HeatSpot['level']) {
  if (level === 'high' || level === 'extreme') return '#f05f43'
  if (level === 'medium') return '#f5a02d'
  return '#43a96f'
}

export function ExposureHotspots({ hotspots }: ExposureHotspotsProps) {
  if (!hotspots.length) {
    return (
      <article className="mini-card panel mini-card--empty">
        <h3>Exposure Hotspots</h3>
        <div className="mini-data-empty"><MapPinned size={22} /><strong>No hotspot model yet</strong><p>HeatShield will only display hotspots after verified spatial analysis exists for the selected site.</p></div>
      </article>
    )
  }

  return (
    <article className="mini-card panel">
      <h3>Exposure Hotspots</h3>
      <div className="hotspot-map">
        <div className="hotspot-map__yard" />
        {hotspots.map((spot) => (
          <span key={spot.id} className="hotspot-map__spot" style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.radius}%`, height: `${spot.radius}%`, background: color(spot.level) }} />
        ))}
      </div>
      <div className="hotspot-legend"><span><i className="legend-dot legend-dot--high" />High</span><span><i className="legend-dot legend-dot--medium" />Medium</span><span><i className="legend-dot legend-dot--low" />Low</span></div>
    </article>
  )
}
