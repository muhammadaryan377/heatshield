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

export interface Worker {
  id: string
  name: string
  initials: string
  role: string
  location: string
  locationId: string
  status: WorkerStatus
  risk: RiskLevel
  lastCheckIn: string
  coordinate: Coordinate
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
  observedAt: string
  isLive: boolean
  conditions: {
    temperatureC: number
    humidityPercent: number
    heatIndexC: number
    feelsLikeC: number
    windKph: number
    windDirection: string
    weatherLabel: string
  }
  deltas: {
    temperatureC: number
    humidityPercent: number
    heatIndexC: number
    comparedAt: string
  }
  risk: {
    level: RiskLevel
    summary: string
    detail: string
    peakWindowStart: string
    peakWindowEnd: string
  }
  workers: Worker[]
  highExposureCount: number
  forecast: ForecastPoint[]
  hotspots: HeatSpot[]
  nextAction: {
    title: string
    detail: string
    actionLabel: string
    dueInMinutes: number
  }
}
