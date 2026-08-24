export type FortyGuardAnalysis = 'geographic' | 'environmental' | 'urban' | 'events' | 'anthropogenic'

export interface FortyGuardAdvancedSnapshotRequest {
  date?: string
  time?: string
  granularityMeters: 60 | 80 | 100
}

export interface FortyGuardAirQuality {
  aqiUs?: number | null
  pm25Aqi?: number | null
  pm10Aqi?: number | null
  no2Aqi?: number | null
  coAqi?: number | null
  o3Aqi?: number | null
  so2Aqi?: number | null
}

export interface FortyGuardSolarIrradiance {
  ghiWm2?: number | null
  dniWm2?: number | null
  dhiWm2?: number | null
  description?: string | null
}

export interface FortyGuardEnvironmentalEvidence {
  heatIndexC?: number | null
  apparentTemperatureC?: number | null
  wetBulbTemperatureC?: number | null
  relativeHumidityPercent?: number | null
  precipitationMm?: number | null
  cloudCoverMetric?: number | null
  methanePpb?: number | null
  co2Ppm?: number | null
  elevationM?: number | null
  airQuality: FortyGuardAirQuality
  solar: FortyGuardSolarIrradiance
  availableMetricCount: number
}

export interface FortyGuardMapStatistics {
  tileCount: number
  minTemperatureC?: number | null
  maxTemperatureC?: number | null
  meanTemperatureC?: number | null
  standardDeviationC?: number | null
  distribution: {
    overallC: number[]
    normalXAxisC: number[]
    normalDensity: number[]
    frequency: Record<string, number>
  }
}

export interface FortyGuardAdvancedSnapshot {
  siteId: string
  siteName: string
  observedAt: string
  timezoneName: string
  sourceAgeHours: number
  granularityMeters: number
  temperatureC: number
  heatmapActivityId: string
  environmentActivityId?: string | null
  mapStatistics: FortyGuardMapStatistics
  environment: FortyGuardEnvironmentalEvidence
  dataStatus: 'verified' | 'partial'
  warnings: string[]
}

export interface FortyGuardHeatIntelligenceRequest {
  date?: string
  time?: string
  granularityMeters: 60 | 80 | 100
  analysis: FortyGuardAnalysis[]
}

export interface FortyGuardHeatIntelligenceSubmission {
  activityId: string
  siteId: string
  siteName: string
  observedAt: string
  temperatureC: number
  analysis: FortyGuardAnalysis[]
  status: 'submitted'
  message: string
}

export interface FortyGuardHeatIntelligenceStatus {
  activityId: string
  status: 'processing' | 'completed' | 'failed' | 'unknown'
  ready: boolean
  message?: string | null
}

export interface FortyGuardUsageSummary {
  dataStatus: 'verified' | 'unavailable' | 'configuration_required'
  plan?: string | null
  monthlyCredits?: number | null
  usedCredits?: number | null
  remainingCredits?: number | null
  creditsResetDate?: string | null
  activityBreakdown: Record<string, number>
  raw: Record<string, unknown>
  message?: string | null
}
