type ModuleId = 'workforce' | 'enterprise' | 'agriculture' | 'urban' | 'global'

const STORAGE_KEYS: Record<Exclude<ModuleId, 'global'>, string> = {
  workforce: 'heatshield:selected-site',
  enterprise: 'heatshield:selected-site',
  agriculture: 'heatshield:selected-agriculture-farm',
  urban: 'heatshield:selected-urban-district',
}

function storedContext(module: Exclude<ModuleId, 'global'>) {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEYS[module])
}

/**
 * Preserve the active operating context while moving between screens in a module.
 *
 * Workforce/Enterprise use `site`, Agriculture uses `farm`, and Urban uses
 * `district`. The shared Command Agent always accepts the selected boundary as
 * `site`, so the helper translates the module-specific context for that route.
 */
export function contextualModuleRoute(to: string, module: ModuleId, currentSearch = '') {
  if (module === 'global') return to

  const current = new URLSearchParams(currentSearch)
  const contextKey = module === 'agriculture' ? 'farm' : module === 'urban' ? 'district' : 'site'
  const contextId = current.get(contextKey) ?? storedContext(module)
  if (!contextId) return to

  const queryIndex = to.indexOf('?')
  const pathname = queryIndex >= 0 ? to.slice(0, queryIndex) : to
  const target = new URLSearchParams(queryIndex >= 0 ? to.slice(queryIndex + 1) : '')

  if (pathname === '/agent') {
    target.set('module', module)
    target.set('site', contextId)
  } else {
    target.set(contextKey, contextId)
  }

  const query = target.toString()
  return query ? `${pathname}?${query}` : pathname
}
