import type { Coordinate } from './site'

export interface HistoricalHeatBehaviorRequest {
  startDate?: string
  endDate?: string
  thresholdF: number
  granularityMeters: 60 | 80 | 100
}

export interface HistoricalLayerStatus {
  analyticType: 'exceedance' | 'persistence' | 'time_of_measure'
  status: 'verified' | 'unavailable'
  activityId?: string | null
  cellCount: number
  units?: string | null
  minValue?: number | null
  maxValue?: number | null
  meanValue?: number | null
  message?: string | null
}

export interface HistoricalHeatCell {
  id: string
  polygon: Coordinate[]
  exceedanceHours?: number | null
  persistenceHours?: number | null
  peakHourUtc?: number | null
  peakHourLocal?: string | null
}

export interface HistoricalZoneSample {
  zoneId: string
  zoneName: string
  zoneType: string
  evidenceStatus: 'complete' | 'partial' | 'unmatched'
  exceedanceHours?: number | null
  persistenceHours?: number | null
  peakHourUtc?: number | null
  peakHourLocal?: string | null
}

export interface HistoricalHeatBehaviorResponse {
  siteId: string
  siteName: string
  startDate: string
  endDate: string
  dayCount: number
  thresholdF: number
  thresholdC: number
  timezoneName: string
  granularityMeters: number
  dataStatus: 'verified' | 'partial' | 'unavailable' | 'configuration_required'
  generatedAt: string
  providerRequestCount: number
  cellCount: number
  meanExceedanceHours?: number | null
  maxExceedanceHours?: number | null
  meanPersistenceHours?: number | null
  maxPersistenceHours?: number | null
  commonPeakHourUtc?: number | null
  commonPeakHourLocal?: string | null
  commonPeakPeriodLocal?: string | null
  layers: HistoricalLayerStatus[]
  cells: HistoricalHeatCell[]
  zones: HistoricalZoneSample[]
  message?: string | null
  cached: boolean
}
