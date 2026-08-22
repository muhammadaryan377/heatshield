import type {
  OperationalPlan,
  Site,
  SiteCreate,
  SiteIntelligence,
  ThermalMapRequest,
  ThermalMapResponse,
  Worker,
  WorkerCreate,
} from '../types/site'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

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
  listSites(signal?: AbortSignal) {
    return request<Site[]>('/api/sites', { signal })
  },
  createSite(payload: SiteCreate) {
    return request<Site>('/api/sites', { method: 'POST', body: JSON.stringify(payload) })
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
