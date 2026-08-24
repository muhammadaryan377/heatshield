import type { Site } from './site'

export type PortfolioEvidenceState = 'verified' | 'partial' | 'unavailable' | 'pending'
export type PortfolioRiskBand = 'low' | 'medium' | 'high' | 'critical' | 'unassessed'

export interface PortfolioAssetSummary {
  total: number
  businessCritical: number
  assessed: number
  highRisk: number
  criticalRisk: number
  thermalLimitBreaches: number
  coolingDependent: number
}

export interface PortfolioSiteAssessment {
  site: Site
  evidenceState: PortfolioEvidenceState
  riskBand: PortfolioRiskBand
  riskScore?: number | null
  peakTemperatureC?: number | null
  meanTemperatureC?: number | null
  maxPersistenceHours?: number | null
  meanExceedanceHours?: number | null
  commonPeakPeriodLocal?: string | null
  latestObservedAt?: string | null
  providerRequestCount: number
  assetSummary: PortfolioAssetSummary
  businessCriticalityScore: number
  rationale: string
  warnings: string[]
  completedAt?: string | null
}
