import { PanelLeftOpen } from 'lucide-react'
import { useState, type PropsWithChildren } from 'react'
import { Sidebar } from './Sidebar'

const SIDEBAR_STORAGE_KEY = 'heatshield:sidebar-hidden'

export type HeatShieldModule = 'workforce' | 'enterprise' | 'agriculture' | 'urban' | 'global'

function initialSidebarHidden() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
}

interface AppShellProps extends PropsWithChildren {
  module?: HeatShieldModule
}

export function AppShell({ children, module = 'workforce' }: AppShellProps) {
  const [sidebarHidden, setSidebarHidden] = useState(initialSidebarHidden)

  const setHidden = (hidden: boolean) => {
    setSidebarHidden(hidden)
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(hidden))
  }

  return (
    <div className={`app-shell${sidebarHidden ? ' app-shell--sidebar-hidden' : ''}`}>
      <Sidebar module={module} hidden={sidebarHidden} onHide={() => setHidden(true)} />

      {sidebarHidden && (
        <button
          type="button"
          className="sidebar-reopen"
          onClick={() => setHidden(false)}
          aria-label="Show navigation sidebar"
          title="Show sidebar"
        >
          <PanelLeftOpen size={19} strokeWidth={1.9} />
        </button>
      )}

      <main className="app-shell__main">{children}</main>
    </div>
  )
}
