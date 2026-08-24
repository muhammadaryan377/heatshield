import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  message: string | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'An unexpected interface error occurred.',
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('HeatShield UI error', error, info.componentStack)
  }

  private reload = () => window.location.reload()

  private goHome = () => {
    window.location.assign('/')
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="app-error-boundary" role="alert">
        <section className="app-error-boundary__card">
          <span className="app-error-boundary__eyebrow">HEATSHIELD RECOVERY</span>
          <h1>This screen could not finish rendering</h1>
          <p>
            Your saved site and asset data has not been changed. Reload the screen, or return to the
            module selector and reopen the workspace.
          </p>
          {this.state.message && <code>{this.state.message}</code>}
          <div>
            <button type="button" className="button button--primary" onClick={this.reload}>Reload screen</button>
            <button type="button" className="button button--secondary" onClick={this.goHome}>All Modules</button>
          </div>
        </section>
      </main>
    )
  }
}
