import type {
  AgricultureField,
  AgricultureFieldCreate,
  AgricultureFieldHeatProfile,
  AgricultureFieldHeatRequest,
} from '../types/agriculture'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

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
    throw new Error(message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const agricultureApi = {
  listFields(siteId: string, signal?: AbortSignal) {
    return request<AgricultureField[]>(`/api/sites/${siteId}/fields`, { signal })
  },
  createField(siteId: string, payload: AgricultureFieldCreate) {
    return request<AgricultureField>(`/api/sites/${siteId}/fields`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  deleteField(siteId: string, fieldId: string) {
    return request<void>(`/api/sites/${siteId}/fields/${fieldId}`, { method: 'DELETE' })
  },
  generateFieldHeatProfile(
    siteId: string,
    fieldId: string,
    payload: AgricultureFieldHeatRequest,
    signal?: AbortSignal,
  ) {
    return request<AgricultureFieldHeatProfile>(
      `/api/sites/${siteId}/fields/${fieldId}/fortyguard-profile`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      },
    )
  },
}
