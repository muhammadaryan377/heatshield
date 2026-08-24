export type EnterpriseReportTemplate = 'executive' | 'property' | 'assets' | 'industrial'
export type EnterpriseReportPriority = 'monitor' | 'attention' | 'high' | 'critical' | 'unassessed'
export type EnterpriseReportEvidenceState = 'verified' | 'partial' | 'unavailable'

export interface EnterpriseReportAssetFinding {
  assetId: string
  assetCode: string
  name: string
  type: string
  criticality: 'low' | 'medium' | 'high' | 'critical'
  latestTemperatureC?: number | null
  exceedanceHours?: number | null
  persistenceHours?: number | null
  peakHourLocal?: string | null
  heatLimitC?: number | null
  heatLimitExceeded: boolean
  evidenceMatched: boolean
}

export interface EnterpriseHeatRiskReport {
  id: string
  generatedAt: string
  template: EnterpriseReportTemplate
  title: string
  site: {
    id: string
    name: string
    address: string
  }
  controls: {
    completedDay: string
    thresholdC: number
    granularityMeters: 60 | 80 | 100
  }
  evidence: {
    state: EnterpriseReportEvidenceState
    latestThermalStatus: string
    latestObservedAt?: string | null
    peakTemperatureC?: number | null
    meanTemperatureC?: number | null
    tileCount: number
    historicalStatus: string
    maxPersistenceHours?: number | null
    meanExceedanceHours?: number | null
    commonPeakPeriodLocal?: string | null
    providerRequestCount: number
    conditionSource?: string | null
    fallbackActive: boolean
  }
  assets: {
    total: number
    businessCritical: number
    matched: number
    coolingDependent: number
    heatLimitBreaches: number
    findings: EnterpriseReportAssetFinding[]
  }
  analysis: {
    priority: EnterpriseReportPriority
    headline: string
    summary: string
    findings: string[]
    actions: string[]
  }
  provenance: Array<{
    label: string
    source: string
    status: string
  }>
}
