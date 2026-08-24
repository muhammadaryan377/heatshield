import type { HistoricalLayerStatus, HistoricalZoneSample } from './history'
import type { OperationalApproval, SiteIntelligence } from './site'

export type WorkforceReportType = 'daily_operations' | 'worker_exposure' | 'historical_site'
export type WorkforceReportEvidenceStatus = 'verified' | 'partial' | 'limited'

export interface HistoricalReportSummary {
  startDate: string
  endDate: string
  dayCount: number
  thresholdC: number
  thresholdF: number
  granularityMeters: number
  dataStatus: 'verified' | 'partial' | 'unavailable' | 'configuration_required'
  providerRequestCount: number
  cellCount: number
  meanTemperatureC?: number | null
  minTemperatureC?: number | null
  maxTemperatureC?: number | null
  meanExceedanceHours?: number | null
  maxExceedanceHours?: number | null
  meanPersistenceHours?: number | null
  maxPersistenceHours?: number | null
  commonPeakPeriodLocal?: string | null
  generatedAt: string
  layers: HistoricalLayerStatus[]
  topZones: HistoricalZoneSample[]
}

export interface WorkforceReportSnapshot {
  id: string
  type: WorkforceReportType
  title: string
  generatedAt: string
  siteId: string
  siteName: string
  siteAddress: string
  evidenceStatus: WorkforceReportEvidenceStatus
  workerId?: string | null
  intelligence: SiteIntelligence
  approvals: OperationalApproval[]
  historical?: HistoricalReportSummary | null
  historicalRequested: boolean
}
