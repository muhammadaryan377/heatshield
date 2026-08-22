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
  workerCode?: string | null
  name: string
  initials: string
  role: string
  team?: string | null
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
  supervisor?: string | null
  notes?: string | null
}

export interface WorkerCreate {
  workerCode?: string
  name: string
  role: string
  team?: string
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
  supervisor?: string
  status?: WorkerStatus
  notes?: string
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
  conditionSource?: 'fortyguard' | 'nws' | null
  conditionSourceLabel?: string | null
  thermalStatus: 'verified' | 'recent_verified' | 'unavailable' | 'not_configured'
  thermalObservedAt?: string | null
  thermalMessage?: string | null
  fallbackActive: boolean
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

export interface PlanWorkerAction {
  workerId: string
  workerName: string
  role: string
  area: string
  riskLevel: RiskLevel
  currentIssue: string
  recommendedAction: string
  timeWindow: string
  rationale: string
}

export interface PlanTimelineItem {
  time: string
  title: string
  detail: string
  category: 'hydration' | 'work_planning' | 'rotation' | 'recovery' | 'assessment' | 'closeout'
}

export interface PlanSiteAction {
  id: string
  title: string
  detail: string
  priority: 'now' | 'today' | 'monitor'
}

export interface OperationalPlan {
  site: Site
  generatedAt: string
  planStatus: 'ready' | 'limited_data' | 'no_workers'
  agentMode: 'deterministic' | 'deepseek_assisted'
  overallRisk: RiskLevel
  riskHeadline: string
  riskSummary: string
  inputs: {
    conditionSource?: 'fortyguard' | 'nws' | null
    thermalStatus: string
    observedAt?: string | null
    temperatureC?: number | null
    humidityPercent?: number | null
    heatIndexC?: number | null
    windKph?: number | null
    workerCount: number
    highExposureWorkers: number
    directSunWorkers: number
    heavyWorkWorkers: number
    limitedShadeWorkers: number
  }
  workers: PlanWorkerAction[]
  timeline: PlanTimelineItem[]
  siteActions: PlanSiteAction[]
  reasoning: string
  reasoningFactors: string[]
}

export interface ThermalMapRequest {
  mode: 'site' | 'custom'
  polygon?: Coordinate[]
  granularityMeters: number
}

export interface ThermalTile {
  id: string
  temperatureC: number
  polygon: Coordinate[]
}

export interface ThermalMapResponse {
  siteId: string
  mode: 'site' | 'custom'
  dataStatus: 'verified' | 'unavailable' | 'configuration_required'
  observedAt?: string | null
  timezoneName?: string | null
  granularityMeters: number
  tileCount: number
  minTemperatureC?: number | null
  maxTemperatureC?: number | null
  meanTemperatureC?: number | null
  hottestTileId?: string | null
  coolestTileId?: string | null
  tiles: ThermalTile[]
  message?: string | null
  cached: boolean
}
