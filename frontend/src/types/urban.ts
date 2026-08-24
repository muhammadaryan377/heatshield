import type { Coordinate, ThermalMapResponse } from './site'

export interface UrbanMorphologyRequest {
  latitude: number
  longitude: number
  observedAt: string
  granularityMeters: 60 | 80 | 100
  includeStreetView: boolean
}

export interface UrbanSegmentationLayer {
  kind: 'satellite' | 'streetview'
  status: 'verified' | 'unavailable'
  activityId?: string | null
  imageDate?: string | null
  imageYear?: number | null
  segments: Record<string, number>
  originalImageDataUrl?: string | null
  segmentedImageDataUrl?: string | null
  message?: string | null
}

export interface UrbanMorphologyResponse {
  siteId: string
  latitude: number
  longitude: number
  observedAt: string
  dataStatus: 'verified' | 'partial' | 'unavailable' | 'configuration_required'
  providerRequestCount: number
  satellite: UrbanSegmentationLayer
  streetView: UrbanSegmentationLayer
  coolingCoveragePercent?: number | null
  heatStoringCoveragePercent?: number | null
  dominantClasses: string[]
  message?: string | null
}

export type UrbanInterventionType =
  | 'tree_canopy'
  | 'shade_structure'
  | 'cool_surface'
  | 'green_surface'
  | 'cool_roof'
  | 'other'

export type UrbanInterventionStatus = 'proposed' | 'approved' | 'in_progress' | 'completed' | 'archived'

export interface UrbanInterventionEvidence {
  source: 'fortyguard'
  cellId: string
  latitude: number
  longitude: number
  cellPolygon?: Coordinate[]
  baselineObservedAt: string
  baselineTemperatureC: number
  districtMeanTemperatureC: number
  anomalyC: number
  historicalStartDate?: string | null
  historicalEndDate?: string | null
  thresholdF?: number | null
  persistenceHours?: number | null
  exceedanceHours?: number | null
  peakHourLocal?: string | null
  morphologyStatus: 'verified' | 'partial' | 'unavailable' | 'not_requested'
  coolingCoveragePercent?: number | null
  heatStoringCoveragePercent?: number | null
  dominantClasses: string[]
}

export interface UrbanInterventionCreate {
  type: UrbanInterventionType
  title: string
  owner?: string | null
  targetDate?: string | null
  targetAreaM2?: number | null
  rationale: string
  mechanism: string
  measurementPlan: string
  evidence: UrbanInterventionEvidence
}

export interface UrbanIntervention {
  id: string
  siteId: string
  type: UrbanInterventionType
  title: string
  status: UrbanInterventionStatus
  owner?: string | null
  targetDate?: string | null
  targetAreaM2?: number | null
  rationale: string
  mechanism: string
  measurementPlan: string
  evidence: UrbanInterventionEvidence
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export interface UrbanBeforeAfterRequest {
  granularityMeters: 60 | 80 | 100
  localTimeToleranceMinutes: number
}

export type UrbanBeforeAfterStatus = 'verified' | 'context_only' | 'not_ready' | 'unavailable' | 'configuration_required'
export type UrbanBeforeAfterInterpretation =
  | 'relative_cooling_signal'
  | 'relative_warming_signal'
  | 'no_clear_change'
  | 'not_comparable'

export interface UrbanBeforeAfterVerification {
  id?: string | null
  siteId: string
  interventionId: string
  generatedAt: string
  dataStatus: UrbanBeforeAfterStatus
  interpretation: UrbanBeforeAfterInterpretation
  evidenceStrength: 'strong' | 'limited' | 'insufficient'
  baselineObservedAt: string
  baselineTemperatureC: number
  baselineDistrictMeanC: number
  baselineAnomalyC: number
  afterObservedAt?: string | null
  afterTemperatureC?: number | null
  afterDistrictMeanC?: number | null
  afterAnomalyC?: number | null
  rawTemperatureChangeC?: number | null
  anomalyChangeC?: number | null
  localClockDifferenceMinutes?: number | null
  localTimeToleranceMinutes: number
  timeMatched: boolean
  afterObservationAfterCompletion: boolean
  targetCellMatched: boolean
  completionTimestamp?: string | null
  afterThermal?: ThermalMapResponse | null
  message: string
}
