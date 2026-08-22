import type { PropsWithChildren } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-shell__main">{children}</main>
    </div>
  )
}
