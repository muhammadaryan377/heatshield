let mapsPromise: Promise<typeof google> | null = null

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window !== 'undefined' && window.google?.maps) {
    return Promise.resolve(window.google)
  }

  if (mapsPromise) return mapsPromise

  mapsPromise = new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('Google Maps API key is not configured.'))
      return
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-heatshield-google-maps]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.dataset.heatshieldGoogleMaps = 'true'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.google)
    script.onerror = () => reject(new Error('Google Maps failed to load.'))
    document.head.appendChild(script)
  })

  return mapsPromise
}
