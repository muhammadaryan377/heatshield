import { AlertTriangle, LoaderCircle } from 'lucide-react'

interface StatePanelProps {
  kind: 'loading' | 'error'
  title: string
  detail: string
  onRetry?: () => void
}

export function StatePanel({ kind, title, detail, onRetry }: StatePanelProps) {
  return (
    <div className={`state-panel state-panel--${kind}`}>
      {kind === 'loading' ? <LoaderCircle className="state-panel__spinner" size={26} /> : <AlertTriangle size={26} />}
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {kind === 'error' && onRetry && <button className="button button--secondary" onClick={onRetry}>Retry</button>}
    </div>
  )
}
