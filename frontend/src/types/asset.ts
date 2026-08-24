import type { Coordinate } from './site'

export type EnterpriseAssetType =
  | 'transformer'
  | 'hvac'
  | 'chiller'
  | 'generator'
  | 'cooling_tower'
  | 'ups'
  | 'server_room'
  | 'loading_area'
  | 'other'

export type EnterpriseAssetCriticality = 'low' | 'medium' | 'high' | 'critical'
export type EnterpriseAssetStatus = 'operational' | 'maintenance' | 'offline'

export interface EnterpriseAsset {
  id: string
  siteId: string
  assetCode: string
  name: string
  type: EnterpriseAssetType
  coordinate: Coordinate
  criticality: EnterpriseAssetCriticality
  status: EnterpriseAssetStatus
  heatLimitC?: number | null
  coolingDependent: boolean
  owner?: string | null
  notes?: string | null
  createdAt: string
}

export interface EnterpriseAssetCreate {
  assetCode?: string
  name: string
  type: EnterpriseAssetType
  coordinate: Coordinate
  criticality: EnterpriseAssetCriticality
  status: EnterpriseAssetStatus
  heatLimitC?: number | null
  coolingDependent: boolean
  owner?: string
  notes?: string
}

export type AssetEvidenceState = 'complete' | 'thermal_only' | 'historical_only' | 'unavailable'
export type AssetRiskBand = 'low' | 'medium' | 'high' | 'critical' | 'unassessed'

export interface EnterpriseAssetExposure {
  asset: EnterpriseAsset
  evidenceState: AssetEvidenceState
  latestTemperatureC?: number | null
  thermalTileId?: string | null
  exceedanceHours?: number | null
  persistenceHours?: number | null
  peakHourLocal?: string | null
  heatLimitExceeded: boolean
  riskScore?: number | null
  riskBand: AssetRiskBand
  rationale: string
}
