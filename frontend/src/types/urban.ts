export interface UrbanMorphologyRequest {
  latitude: number
  longitude: number
  observedAt: string
  granularityMeters: 60 | 80 | 100
  includeStreetView: boolean
}

export interface UrbanSegmentationLayer {
  kind: 'satellite' | 'streetview'
  status: 'verified' | 'unavailable'
  activityId?: string | null
  imageDate?: string | null
  imageYear?: number | null
  segments: Record<string, number>
  originalImageDataUrl?: string | null
  segmentedImageDataUrl?: string | null
  message?: string | null
}

export interface UrbanMorphologyResponse {
  siteId: string
  latitude: number
  longitude: number
  observedAt: string
  dataStatus: 'verified' | 'partial' | 'unavailable' | 'configuration_required'
  providerRequestCount: number
  satellite: UrbanSegmentationLayer
  streetView: UrbanSegmentationLayer
  coolingCoveragePercent?: number | null
  heatStoringCoveragePercent?: number | null
  dominantClasses: string[]
  message?: string | null
}
