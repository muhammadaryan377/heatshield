import { AlertTriangle, Inbox, LoaderCircle } from 'lucide-react'

interface StatePanelProps {
  kind: 'loading' | 'error' | 'empty'
  title: string
  detail: string
  onRetry?: () => void
}

export function StatePanel({ kind, title, detail, onRetry }: StatePanelProps) {
  const icon = kind === 'loading'
    ? <LoaderCircle className="state-panel__spinner" size={26} aria-hidden="true" />
    : kind === 'empty'
      ? <Inbox size={26} aria-hidden="true" />
      : <AlertTriangle size={26} aria-hidden="true" />

  return (
    <div
      className={`state-panel state-panel--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'loading' ? 'polite' : 'assertive'}
      aria-busy={kind === 'loading'}
    >
      {icon}
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {kind === 'error' && onRetry && (
        <button type="button" className="button button--secondary" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}
