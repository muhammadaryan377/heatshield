import { ArrowLeft, Home } from 'lucide-react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <section className="not-found-page__card">
        <span className="not-found-page__eyebrow">HEATSHIELD</span>
        <strong className="not-found-page__code">404</strong>
        <h1>That workspace route does not exist</h1>
        <p>Use the module selector or return to Enterprise Overview. No project data has been changed.</p>
        <div>
          <Link to="/" className="button button--secondary"><ArrowLeft size={16} /> All Modules</Link>
          <Link to="/enterprise" className="button button--primary"><Home size={16} /> Enterprise Overview</Link>
        </div>
      </section>
    </main>
  )
}
