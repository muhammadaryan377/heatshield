import type { Coordinate } from './site'

export interface AgricultureField {
  id: string
  siteId: string
  name: string
  crop?: string | null
  growthStage?: string | null
  center: Coordinate
  polygon: Coordinate[]
  status: 'active' | 'inactive'
}

export interface AgricultureFieldCreate {
  name: string
  crop?: string | null
  growthStage?: string | null
  polygon: Coordinate[]
}

export type AgricultureFieldLayerType = 'tcm' | 'time_of_measure' | 'exceedance' | 'persistence'

export interface AgricultureFieldHeatCell {
  id: string
  value: number
  polygon: Coordinate[]
}

export interface AgricultureFieldHeatLayer {
  analyticType: AgricultureFieldLayerType
  status: 'verified' | 'unavailable'
  activityId?: string | null
  units?: string | null
  minValue?: number | null
  maxValue?: number | null
  meanValue?: number | null
  cells: AgricultureFieldHeatCell[]
  message?: string | null
}

export interface AgricultureFieldHeatProfile {
  siteId: string
  fieldId: string
  fieldName: string
  date: string
  timezoneName: string
  thresholdC: number
  granularityMeters: number
  dataStatus: 'verified' | 'partial' | 'unavailable' | 'configuration_required'
  generatedAt: string
  providerRequestCount: number
  minTemperatureC?: number | null
  meanTemperatureC?: number | null
  maxTemperatureC?: number | null
  peakHourUtc?: number | null
  peakHourLocal?: string | null
  meanHoursAboveThreshold?: number | null
  maxHoursAboveThreshold?: number | null
  meanPersistenceHours?: number | null
  maxPersistenceHours?: number | null
  layers: AgricultureFieldHeatLayer[]
  message?: string | null
  cached: boolean
}

export interface AgricultureFieldHeatRequest {
  date?: string | null
  thresholdC: number
  granularityMeters: 60 | 80 | 100
}
