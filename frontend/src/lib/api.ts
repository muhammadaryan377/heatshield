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

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export type FortyGuardProviderStatus = 'verified' | 'partial' | 'unavailable' | 'configuration_required' | 'premium_required'

export interface ConfigStatus {
  fortyguardConfigured: boolean
  fortyguardBaseUrl: string
  nwsFallbackEnabled: boolean
  nwsBaseUrl: string
  deepseekConfigured: boolean
  fixturesEnabled: boolean
  environment: string
}

export interface FortyGuardEnvironmentalContext {
  siteId: string
  dataStatus: FortyGuardProviderStatus
  observedAt?: string | null
  timezoneName?: string | null
  activityId?: string | null
  heatmapActivityId?: string | null
  temperatureC?: number | null
  heatIndexC?: number | null
  apparentTemperatureC?: number | null
  wetBulbTemperatureC?: number | null
  relativeHumidityPercent?: number | null
  precipitationMm?: number | null
  cloudCoverMetric?: number | null
  aqiUs?: number | null
  aqiPm25?: number | null
  aqiPm10?: number | null
  aqiNo2?: number | null
  aqiCo?: number | null
  aqiO3?: number | null
  aqiSo2?: number | null
  methanePpb?: number | null
  co2Ppm?: number | null
  solarGhi?: number | null
  solarDni?: number | null
  solarDhi?: number | null
  solarDescription?: string | null
  message?: string | null
  cached: boolean
}

export interface FortyGuardSegmentationView {
  status: FortyGuardProviderStatus
  activityId?: string | null
  imageDataUrl?: string | null
  segmentedImageDataUrl?: string | null
  imageDate?: string | null
  imageYear?: number | null
  segments: Record<string, number>
  legend: Record<string, unknown>
  processingTimeSeconds?: number | null
  message?: string | null
}

export interface FortyGuardPhysicalContextRequest {
  granularityMeters: 60 | 80 | 100
  includeSatellite: boolean
  includeStreetView: boolean
  streetHorizontalAngle: number
  streetVerticalAngle: number
  streetBackView: boolean
}

export interface FortyGuardPhysicalContext {
  siteId: string
  dataStatus: FortyGuardProviderStatus
  generatedAt: string
  observationTime?: string | null
  satellite?: FortyGuardSegmentationView | null
  streetFront?: FortyGuardSegmentationView | null
  streetBack?: FortyGuardSegmentationView | null
  message?: string | null
}

export type HeatIntelligenceCategory = 'geographic' | 'environmental' | 'urban' | 'events' | 'anthropogenic'

export interface FortyGuardHeatIntelligence {
  siteId: string
  dataStatus: FortyGuardProviderStatus
  activityId?: string | null
  reportId?: string | null
  downloadPath?: string | null
  observedAt?: string | null
  analysis: string[]
  message?: string | null
}

export interface FortyGuardUsage {
  dataStatus: 'verified' | 'unavailable' | 'configuration_required'
  fetchedAt: string
  plan?: string | null
  creditsUsed?: number | null
  creditsRemaining?: number | null
  creditsLimit?: number | null
  creditsResetDate?: string | null
  activityBreakdown: Record<string, unknown>
  raw: Record<string, unknown>
  message?: string | null
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function resolveApiPath(path: string) {
  return `${BASE_URL}${path}`
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
  getFortyGuardEnvironment(siteId: string, forceRefresh = false, signal?: AbortSignal) {
    return request<FortyGuardEnvironmentalContext>(`/api/sites/${siteId}/fortyguard/environment`, {
      method: 'POST',
      body: JSON.stringify({ forceRefresh }),
      signal,
    })
  },
  getFortyGuardPhysicalContext(siteId: string, payload: FortyGuardPhysicalContextRequest, signal?: AbortSignal) {
    return request<FortyGuardPhysicalContext>(`/api/sites/${siteId}/fortyguard/physical-context`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
  generateFortyGuardHeatIntelligence(siteId: string, analysis: HeatIntelligenceCategory[], signal?: AbortSignal) {
    return request<FortyGuardHeatIntelligence>(`/api/sites/${siteId}/fortyguard/heat-intelligence`, {
      method: 'POST',
      body: JSON.stringify({ analysis }),
      signal,
    })
  },
  getFortyGuardUsage(signal?: AbortSignal) {
    return request<FortyGuardUsage>('/api/fortyguard/usage', { signal })
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
