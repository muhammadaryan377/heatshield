import type { Site, SiteUpdate, SiteZoneCreate } from '../types/site'

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
    } catch { /* keep status message */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export const siteManagementApi = {
  updateSite(siteId: string, payload: SiteUpdate) {
    return request<Site>(`/api/sites/${siteId}`, { method: 'PUT', body: JSON.stringify(payload) })
  },
  deleteSite(siteId: string) {
    return request<void>(`/api/sites/${siteId}`, { method: 'DELETE' })
  },
  updateZone(siteId: string, zoneId: string, payload: SiteZoneCreate) {
    return request<Site>(`/api/sites/${siteId}/zones/${zoneId}`, { method: 'PUT', body: JSON.stringify(payload) })
  },
}
