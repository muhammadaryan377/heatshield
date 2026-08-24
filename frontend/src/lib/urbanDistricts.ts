import type { Site } from '../types/site'

const URBAN_DISTRICT_IDS_KEY = 'heatshield:urban-district-ids'

export function getUrbanDistrictIds(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(URBAN_DISTRICT_IDS_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  } catch {
    return []
  }
}

export function registerUrbanDistrict(id: string) {
  if (typeof window === 'undefined' || !id) return
  const next = Array.from(new Set([...getUrbanDistrictIds(), id]))
  window.localStorage.setItem(URBAN_DISTRICT_IDS_KEY, JSON.stringify(next))
}

export function unregisterUrbanDistrict(id: string) {
  if (typeof window === 'undefined' || !id) return
  const next = getUrbanDistrictIds().filter((item) => item !== id)
  window.localStorage.setItem(URBAN_DISTRICT_IDS_KEY, JSON.stringify(next))
}

export function filterUrbanDistricts(sites: Site[]): Site[] {
  const ids = getUrbanDistrictIds()
  if (!ids.length) return sites

  const idSet = new Set(ids)
  const filtered = sites.filter((site) => idSet.has(site.id))

  // Preserve compatibility with projects that already had site geometry before
  // the Urban module introduced an explicit district registry.
  return filtered.length ? filtered : sites
}
