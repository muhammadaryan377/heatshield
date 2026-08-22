export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme'
export type WorkerStatus = 'active' | 'break' | 'offsite'

export interface Coordinate {
  lat: number
  lng: number
}

export interface SiteZone {
  id: string
  name: string
  type: 'open-yard' | 'roof' | 'staging' | 'other'
  center: Coordinate
}

export interface Site {
  id: string
  name: string
  address: string
  center: Coordinate
  polygon: Coordinate[]
  zones: SiteZone[]
  status: 'active' | 'inactive'
}

export interface SiteCreate {
  name: string
  address: string
  center: Coordinate
  polygon: Coordinate[]
  zones?: SiteZone[]
}

export interface Worker {
  id: string
  siteId: string
  name: string
  initials: string
  role: string
  location: string
  locationId: string
  status: WorkerStatus
  risk: RiskLevel
  lastCheckIn: string
  coordinate: Coordinate
  task?: string | null
  workIntensity?: 'light' | 'moderate' | 'heavy' | null
  shiftStart?: string | null
  shiftEnd?: string | null
  sunExposure?: 'indoor' | 'partial' | 'direct' | null
  shadeAccess?: 'available' | 'limited' | 'none' | null
  waterAccess?: boolean | null
}

export interface WorkerCreate {
  name: string
  role: string
  location: string
  locationId: string
  coordinate: Coordinate
  task?: string
  workIntensity?: 'light' | 'moderate' | 'heavy'
  shiftStart?: string
  shiftEnd?: string
  sunExposure?: 'indoor' | 'partial' | 'direct'
  shadeAccess?: 'available' | 'limited' | 'none'
  waterAccess?: boolean
}

export interface EnvironmentalMetric {
  value: number
  unit: string
  delta?: number
  deltaLabel?: string
}

export interface ForecastPoint {
  time: string
  temperatureC: number
}

export interface HeatSpot {
  id: string
  level: RiskLevel
  x: number
  y: number
  radius: number
}

export interface SiteIntelligence {
  site: Site
  observedAt?: string | null
  isLive: boolean
  dataStatus: 'live' | 'configuration_required' | 'provider_unavailable'
  statusMessage?: string | null
  conditions?: {
    temperatureC: number
    humidityPercent: number
    heatIndexC: number
    feelsLikeC: number
    windKph?: number | null
    windDirection?: string | null
    weatherLabel?: string | null
  } | null
  deltas?: {
    temperatureC?: number | null
    humidityPercent?: number | null
    heatIndexC?: number | null
    comparedAt?: string | null
  } | null
  risk?: {
    level: RiskLevel
    summary: string
    detail: string
    peakWindowStart?: string | null
    peakWindowEnd?: string | null
  } | null
  workers: Worker[]
  highExposureCount: number
  forecast: ForecastPoint[]
  hotspots: HeatSpot[]
  nextAction?: {
    title: string
    detail: string
    actionLabel: string
    dueInMinutes: number
  } | null
}
