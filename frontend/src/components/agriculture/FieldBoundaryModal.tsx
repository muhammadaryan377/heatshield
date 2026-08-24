import {
  CheckCircle2,
  LoaderCircle,
  MousePointer2,
  RotateCcw,
  Save,
  Sprout,
  Undo2,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { agricultureApi } from '../../lib/agricultureApi'
import { loadGoogleMaps } from '../../lib/googleMaps'
import type { AgricultureField } from '../../types/agriculture'
import type { Coordinate, Site } from '../../types/site'

interface FieldBoundaryModalProps {
  open: boolean
  farm: Site | null
  onClose: () => void
  onCreated: (field: AgricultureField) => void
}

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function pointOnSegment(point: Coordinate, a: Coordinate, b: Coordinate, epsilon = 1e-9) {
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
  let previous = polygon.length - 1
  for (let index = 0; index < polygon.length; index += 1) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    if ((currentPoint.lat > point.lat) !== (previousPoint.lat > point.lat)) {
      const crossing = ((previousPoint.lng - currentPoint.lng) * (point.lat - currentPoint.lat))
        / (previousPoint.lat - currentPoint.lat) + currentPoint.lng
      if (point.lng < crossing) inside = !inside
    }
    previous = index
  }
  return inside
}

export function FieldBoundaryModal({ open, farm, onClose, onCreated }: FieldBoundaryModalProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const farmPolygonRef = useRef<google.maps.Polygon | null>(null)
  const fieldPolygonRef = useRef<google.maps.Polygon | null>(null)
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)

  const [name, setName] = useState('')
  const [crop, setCrop] = useState('')
  const [growthStage, setGrowthStage] = useState('')
  const [points, setPoints] = useState<Coordinate[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapMessage, setMapMessage] = useState('Click around the actual field boundary inside the farm.')

  const hasBoundary = points.length >= 3
  const canSave = Boolean(farm && name.trim().length >= 2 && hasBoundary && !saving)
  const areaPreview = useMemo(() => {
    if (points.length < 3) return null
    const origin = points[0]
    const latScale = 111_320
    const lngScale = 111_320 * Math.cos((origin.lat * Math.PI) / 180)
    let area = 0
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      const x1 = (current.lng - origin.lng) * lngScale
      const y1 = (current.lat - origin.lat) * latScale
      const x2 = (next.lng - origin.lng) * lngScale
      const y2 = (next.lat - origin.lat) * latScale
      area += x1 * y2 - x2 * y1
    }
    return Math.abs(area / 2) / 4046.8564224
  }, [points])

  useEffect(() => {
    if (!open || !farm || !mapElement.current || !mapsApiKey) return
    let cancelled = false
    setError(null)

    loadGoogleMaps(mapsApiKey)
      .then((googleInstance) => {
        if (cancelled || !mapElement.current) return
        const map = new googleInstance.maps.Map(mapElement.current, {
          center: farm.center,
          zoom: 17,
          mapTypeId: googleInstance.maps.MapTypeId.SATELLITE,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })
        mapRef.current = map
        farmPolygonRef.current = new googleInstance.maps.Polygon({
          map,
          paths: farm.polygon,
          strokeColor: '#26c1ad',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#0f8e82',
          fillOpacity: 0.08,
          clickable: false,
          zIndex: 5,
        })
        const bounds = new googleInstance.maps.LatLngBounds()
        farm.polygon.forEach((point) => bounds.extend(point))
        if (!bounds.isEmpty()) map.fitBounds(bounds, 46)

        clickListenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return
          const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }
          if (!pointInPolygon(point, farm.polygon)) {
            setMapMessage('That point is outside the farm. Keep every field corner inside the saved farm boundary.')
            return
          }
          setPoints((current) => [...current, point])
          setMapMessage(null)
          setError(null)
        })
      })
      .catch((cause: Error) => setMapMessage(cause.message))

    return () => {
      cancelled = true
      clickListenerRef.current?.remove()
      clickListenerRef.current = null
      farmPolygonRef.current?.setMap(null)
      fieldPolygonRef.current?.setMap(null)
      farmPolygonRef.current = null
      fieldPolygonRef.current = null
      mapRef.current = null
    }
  }, [farm, open])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.google?.maps) return
    fieldPolygonRef.current?.setMap(null)
    fieldPolygonRef.current = null
    if (!points.length) return
    fieldPolygonRef.current = new window.google.maps.Polygon({
      map,
      paths: points,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: '#f2b441',
      fillOpacity: hasBoundary ? 0.2 : 0.08,
      clickable: false,
      zIndex: 10,
    })
  }, [hasBoundary, points])

  const reset = () => {
    setName('')
    setCrop('')
    setGrowthStage('')
    setPoints([])
    setSaving(false)
    setError(null)
    setMapMessage('Click around the actual field boundary inside the farm.')
  }

  const close = () => {
    if (saving) return
    reset()
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!farm || !canSave) {
      if (!name.trim()) setError('Give this field a name before saving.')
      else if (!hasBoundary) setError('Select at least three field boundary points.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const field = await agricultureApi.createField(farm.id, {
        name: name.trim(),
        crop: crop.trim() || null,
        growthStage: growthStage.trim() || null,
        polygon: points,
      })
      onCreated(field)
      reset()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this field.')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !farm) return null

  return (
    <div className="agri-field-modal-backdrop" role="presentation">
      <section className="agri-field-modal" role="dialog" aria-modal="true" aria-labelledby="field-modal-title">
        <header className="agri-field-modal__header">
          <div>
            <span className="agri-field-eyebrow">FIELD SETUP</span>
            <h2 id="field-modal-title">Add a real field boundary</h2>
            <p>{farm.name} · define the polygon that FortyGuard should analyze.</p>
          </div>
          <button type="button" onClick={close} className="agri-field-icon-button" aria-label="Close field setup" disabled={saving}>
            <X size={19} />
          </button>
        </header>

        <form className="agri-field-modal__body" onSubmit={submit}>
          <aside className="agri-field-form">
            <div className="agri-field-form__intro">
              <Sprout size={22} />
              <div><strong>Field context</strong><span>Crop details are context only; HeatShield will not invent agronomic thresholds from them.</span></div>
            </div>

            <label>
              <span>Field name</span>
              <input value={name} onChange={(event) => { setName(event.target.value); setError(null) }} placeholder="e.g. North Corn Field" autoFocus />
            </label>
            <label>
              <span>Crop <small>optional</small></span>
              <input value={crop} onChange={(event) => setCrop(event.target.value)} placeholder="e.g. Corn" />
            </label>
            <label>
              <span>Growth stage <small>optional</small></span>
              <input value={growthStage} onChange={(event) => setGrowthStage(event.target.value)} placeholder="e.g. Tasseling" />
            </label>

            <div className={`agri-field-boundary-status${hasBoundary ? ' is-ready' : ''}`}>
              {hasBoundary ? <CheckCircle2 size={20} /> : <MousePointer2 size={20} />}
              <div>
                <strong>{hasBoundary ? 'Boundary ready' : 'Draw field boundary'}</strong>
                <span>{points.length} point{points.length === 1 ? '' : 's'} selected{areaPreview != null ? ` · ${areaPreview.toFixed(1)} acres` : ''}</span>
              </div>
            </div>

            <div className="agri-field-tools">
              <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length}><Undo2 size={15} /> Undo</button>
              <button type="button" onClick={() => setPoints([])} disabled={!points.length}><RotateCcw size={15} /> Redraw</button>
            </div>

            {error && <div className="agri-field-form__error">{error}</div>}

            <button type="submit" className="button button--primary agri-field-save" disabled={!canSave}>
              {saving ? <LoaderCircle size={17} className="spin" /> : <Save size={17} />}
              {saving ? 'Saving field…' : 'Save field boundary'}
            </button>
          </aside>

          <div className="agri-field-draw-map">
            {mapsApiKey ? <div ref={mapElement} className="agri-field-draw-map__google" /> : (
              <div className="agri-field-draw-map__fallback">Google Maps API key is required to draw a field boundary.</div>
            )}
            <div className="agri-field-draw-map__hint">
              <strong>{mapMessage ?? 'Boundary point added'}</strong>
              <span>Teal = farm boundary · white/gold = field boundary</span>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
