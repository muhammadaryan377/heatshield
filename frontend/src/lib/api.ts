import type {
  FortyGuardDailyProfile,
  FortyGuardProfileRequest,
  OperationalApproval,
  OperationalApprovalRequest,
  OperationalHeatPlan,
  OperationalPlannerRequest,
  OperationalPlan,
  Site,
  SiteCreate,
  SiteIntelligence,
  SiteZoneCreate,
  ThermalMapRequest,
  ThermalMapResponse,
  Worker,
  WorkerCreate,
} from '../types/site'
import type { HistoricalHeatBehaviorRequest, HistoricalHeatBehaviorResponse } from '../types/history'
import type { EnterpriseAsset, EnterpriseAssetCreate } from '../types/asset'
import type {
  FortyGuardAdvancedSnapshot,
  FortyGuardAdvancedSnapshotRequest,
  FortyGuardHeatIntelligenceRequest,
  FortyGuardHeatIntelligenceStatus,
  FortyGuardHeatIntelligenceSubmission,
  FortyGuardUsageSummary,
} from '../types/fortyguard-advanced'
import type {
  UrbanBeforeAfterRequest,
  UrbanBeforeAfterVerification,
  UrbanIntervention,
  UrbanInterventionCreate,
  UrbanInterventionStatus,
  UrbanMorphologyRequest,
  UrbanMorphologyResponse,
} from '../types/urban'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export interface ConfigStatus {
  fortyguardConfigured: boolean
  fortyguardBaseUrl: string
  nwsFallbackEnabled: boolean
  nwsBaseUrl: string
  deepseekConfigured: boolean
  fixturesEnabled: boolean
  environment: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Preserve the HTTP status message when the response is not JSON.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function downloadBlob(path: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/pdf' } })
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Keep the HTTP status when the response body is not JSON.
    }
    throw new ApiError(message, response.status)
  }
  return response.blob()
}

export const api = {
  getConfigStatus(signal?: AbortSignal) {
    return request<ConfigStatus>('/api/config/status', { signal })
  },
  listSites(signal?: AbortSignal) {
    return request<Site[]>('/api/sites', { signal })
  },
  createSite(payload: SiteCreate) {
    return request<Site>('/api/sites', { method: 'POST', body: JSON.stringify(payload) })
  },
  addSiteZone(siteId: string, payload: SiteZoneCreate) {
    return request<Site>(`/api/sites/${siteId}/zones`, { method: 'POST', body: JSON.stringify(payload) })
  },
  deleteSiteZone(siteId: string, zoneId: string) {
    return request<Site>(`/api/sites/${siteId}/zones/${zoneId}`, { method: 'DELETE' })
  },
  listEnterpriseAssets(siteId: string, signal?: AbortSignal) {
    return request<EnterpriseAsset[]>(`/api/sites/${siteId}/assets`, { signal })
  },
  createEnterpriseAsset(siteId: string, payload: EnterpriseAssetCreate) {
    return request<EnterpriseAsset>(`/api/sites/${siteId}/assets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  deleteEnterpriseAsset(siteId: string, assetId: string) {
    return request<void>(`/api/sites/${siteId}/assets/${assetId}`, { method: 'DELETE' })
  },
  getSiteIntelligence(siteId: string, signal?: AbortSignal) {
    return request<SiteIntelligence>(`/api/sites/${siteId}/intelligence`, { signal })
  },
  generateThermalMap(siteId: string, payload: ThermalMapRequest, signal?: AbortSignal) {
    return request<ThermalMapResponse>(`/api/sites/${siteId}/heatmap`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  generateFortyGuardProfile(siteId: string, payload: FortyGuardProfileRequest, signal?: AbortSignal) {
    return request<FortyGuardDailyProfile>(`/api/sites/${siteId}/fortyguard-profile`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  generateHistoricalHeatBehavior(siteId: string, payload: HistoricalHeatBehaviorRequest, signal?: AbortSignal) {
    return request<HistoricalHeatBehaviorResponse>(`/api/sites/${siteId}/historical-heat-behavior`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  generateUrbanMorphology(siteId: string, payload: UrbanMorphologyRequest, signal?: AbortSignal) {
    return request<UrbanMorphologyResponse>(`/api/sites/${siteId}/urban-morphology`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  listUrbanInterventions(siteId: string, signal?: AbortSignal) {
    return request<UrbanIntervention[]>(`/api/sites/${siteId}/urban-interventions`, { signal })
  },
  createUrbanIntervention(siteId: string, payload: UrbanInterventionCreate) {
    return request<UrbanIntervention>(`/api/sites/${siteId}/urban-interventions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  updateUrbanInterventionStatus(siteId: string, interventionId: string, status: UrbanInterventionStatus) {
    return request<UrbanIntervention>(`/api/sites/${siteId}/urban-interventions/${interventionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },
  listUrbanBeforeAfterVerifications(siteId: string, interventionId: string, signal?: AbortSignal) {
    return request<UrbanBeforeAfterVerification[]>(
      `/api/sites/${siteId}/urban-interventions/${interventionId}/verifications`,
      { signal },
    )
  },
  verifyUrbanIntervention(siteId: string, interventionId: string, payload: UrbanBeforeAfterRequest, signal?: AbortSignal) {
    return request<UrbanBeforeAfterVerification>(
      `/api/sites/${siteId}/urban-interventions/${interventionId}/verify`,
      { method: 'POST', body: JSON.stringify(payload), signal },
    )
  },
  generateOperationalPlanner(siteId: string, payload: OperationalPlannerRequest, signal?: AbortSignal) {
    return request<OperationalHeatPlan>(`/api/sites/${siteId}/operational-planner`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  listOperationalApprovals(siteId: string, signal?: AbortSignal) {
    return request<OperationalApproval[]>(`/api/sites/${siteId}/operational-planner/approvals`, { signal })
  },
  approveOperationalDecision(siteId: string, payload: OperationalApprovalRequest) {
    return request<OperationalApproval>(`/api/sites/${siteId}/operational-planner/approvals`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  verifyOperationalDecision(siteId: string, approvalId: string) {
    return request<OperationalApproval>(`/api/sites/${siteId}/operational-planner/approvals/${approvalId}/verify`, {
      method: 'POST',
    })
  },
  generatePlan(siteId: string, signal?: AbortSignal) {
    return request<OperationalPlan>(`/api/sites/${siteId}/plan`, { method: 'POST', signal })
  },
  listWorkers(siteId: string, signal?: AbortSignal) {
    return request<Worker[]>(`/api/sites/${siteId}/workers`, { signal })
  },
  createWorker(siteId: string, payload: WorkerCreate) {
    return request<Worker>(`/api/sites/${siteId}/workers`, { method: 'POST', body: JSON.stringify(payload) })
  },
  sendHydrationReminder(siteId: string) {
    return request<{ accepted: boolean; message: string }>(
      `/api/sites/${siteId}/actions/hydration-reminder`,
      { method: 'POST' },
    )
  },
  generateFortyGuardAdvancedSnapshot(siteId: string, payload: FortyGuardAdvancedSnapshotRequest, signal?: AbortSignal) {
    return request<FortyGuardAdvancedSnapshot>(`/api/sites/${siteId}/fortyguard/advanced-snapshot`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  submitFortyGuardHeatIntelligence(siteId: string, payload: FortyGuardHeatIntelligenceRequest) {
    return request<FortyGuardHeatIntelligenceSubmission>(`/api/sites/${siteId}/fortyguard/heat-intelligence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  getFortyGuardHeatIntelligenceStatus(activityId: string, signal?: AbortSignal) {
    return request<FortyGuardHeatIntelligenceStatus>(`/api/fortyguard/heat-intelligence/${activityId}/status`, { signal })
  },
  downloadFortyGuardHeatIntelligence(activityId: string) {
    return downloadBlob(`/api/fortyguard/heat-intelligence/${activityId}/download`)
  },
  getFortyGuardUsage(signal?: AbortSignal) {
    return request<FortyGuardUsageSummary>('/api/fortyguard/usage', { signal })
  },
}
