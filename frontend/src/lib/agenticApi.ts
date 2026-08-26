import type { AgenticHeatPlan } from '../types/agentic'
import type { OperationalPlannerRequest } from '../types/site'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Keep HTTP fallback message.
    }
    throw new Error(message)
  }
  return await response.json() as T
}

export const agenticApi = {
  run(siteId: string, payload: OperationalPlannerRequest, signal?: AbortSignal) {
    return request<AgenticHeatPlan>(`/api/sites/${encodeURIComponent(siteId)}/agent/run`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    })
  },
}
