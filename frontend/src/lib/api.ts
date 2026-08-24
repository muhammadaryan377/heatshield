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
import type { UrbanMorphologyRequest, UrbanMorphologyResponse } from '../types/urban'

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

  return (await response.json()) as T
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
  generateOperationalPlanner(siteId: string, payload: OperationalPlannerRequest, signal?: AbortSignal) {
    return request<OperationalHeatPlan>(`/api/sites/${siteId}/operational-planner`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
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
}
