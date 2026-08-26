import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Database,
  Gauge,
  Layers3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { StatePanel } from '../components/ui/StatePanel'
import { api } from '../lib/api'
import type { PlatformModuleReadiness, PlatformReadiness } from '../lib/api'

const mapsConfigured = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

function statusLabel(status: PlatformModuleReadiness['status']) {
  if (status === 'ready') return 'Core ready'
  if (status === 'configure_provider') return 'Configure provider'
  if (status === 'add_site') return 'Add site boundary'
  return 'Add workers'
}

function providerTone(configured: boolean) {
  return configured ? 'ready' : 'attention'
}

const moduleMeta = {
  workforce: { title: 'Workforce Safety', route: '/workforce', purpose: 'Worker exposure, assignment decisions and action plans.' },
  enterprise: { title: 'Enterprise', route: '/enterprise', purpose: 'Site, asset and portfolio thermal exposure decisions.' },
  agriculture: { title: 'Agriculture', route: '/agriculture', purpose: 'Field heat screening, irrigation inspection and work timing.' },
  urban: { title: 'Urban Intelligence', route: '/urban', purpose: 'District hotspots, interventions and before/after evidence.' },
} as const

export function PlatformReadinessPage() {
  const [data, setData] = useState<PlatformReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)

    api.getPlatformReadiness(controller.signal)
      .then((response) => {
        if (!active || controller.signal.aborted) return
        setData(response)
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause, controller.signal)) return
        setError(cause instanceof Error ? cause.message : 'Unable to read HeatShield platform readiness.')
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [refreshKey])

  const moduleRows = useMemo(() => {
    if (!data) return []
    return (Object.keys(moduleMeta) as Array<keyof typeof moduleMeta>).map((key) => ({
      key,
      ...moduleMeta[key],
      readiness: data.modules[key],
    }))
  }, [data])

  return (
    <AppShell module="global">
      <header className="platform-readiness-topbar">
        <div>
          <span className="platform-readiness-eyebrow">HEATSHIELD OPERATIONS</span>
          <h1>Platform Readiness</h1>
          <p>Verify providers, workspace data and module prerequisites before relying on operational decisions.</p>
        </div>
        <div className="platform-readiness-topbar__actions">
          <Link className="button button--secondary" to="/">All Modules</Link>
          <button type="button" className="button button--outline-teal" onClick={refresh} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </header>

      <main className="platform-readiness-page">
        {loading && !data && <StatePanel kind="loading" title="Checking platform readiness" detail="Reading configuration and workspace prerequisites without spending provider credits…" />}
        {error && !data && <StatePanel kind="error" title="Readiness check unavailable" detail={error} onRetry={refresh} />}

        {data && (
          <>
            {error && <div className="platform-readiness-warning"><AlertTriangle size={16} /><span>Refresh failed. Showing the last successful readiness snapshot.</span><button type="button" onClick={refresh}>Retry</button></div>}

            <section className="platform-readiness-hero panel">
              <div className="platform-readiness-score">
                <span className="platform-readiness-score__ring" style={{ '--readiness-score': `${data.readinessScore * 3.6}deg` } as React.CSSProperties}>
                  <strong>{data.readinessScore}</strong><small>/100</small>
                </span>
                <div>
                  <span className="platform-readiness-eyebrow">READINESS SCORE</span>
                  <h2>{data.readinessScore >= 85 ? 'Operational foundation ready' : data.readinessScore >= 60 ? 'Core setup is usable' : 'Setup requires attention'}</h2>
                  <p>This score checks configuration and workspace prerequisites. Every live analysis still reports its own provider availability, timestamp and evidence status.</p>
                </div>
              </div>
              <div className="platform-readiness-hero__facts">
                <div><ShieldCheck size={18} /><span><small>DATA MODE</small><strong>{data.productionSafeDataMode ? 'Production-safe' : 'Fixtures enabled'}</strong></span></div>
                <div><Database size={18} /><span><small>ENVIRONMENT</small><strong>{data.environment}</strong></span></div>
                <div><Activity size={18} /><span><small>ACTIVE SITES</small><strong>{data.workspace.activeSiteCount}</strong></span></div>
              </div>
            </section>

            <section className="platform-readiness-section">
              <div className="platform-readiness-section__head">
                <div><span className="platform-readiness-eyebrow">PROVIDER LAYER</span><h2>Evidence &amp; intelligence services</h2></div>
                <small>No secrets are exposed and this readiness check does not submit FortyGuard jobs.</small>
              </div>
              <div className="platform-provider-grid">
                <article className={`platform-provider-card panel platform-provider-card--${providerTone(data.providers.fortyguard.configured)}`}>
                  <span className="platform-provider-card__icon"><Layers3 size={21} /></span>
                  <div><small>PRIMARY THERMAL EVIDENCE</small><h3>FortyGuard</h3><p>{data.providers.fortyguard.role}</p></div>
                  <span className="platform-provider-card__status">{data.providers.fortyguard.configured ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{data.providers.fortyguard.configured ? 'Configured' : 'Needs API key'}</span>
                </article>
                <article className="platform-provider-card panel platform-provider-card--ready">
                  <span className="platform-provider-card__icon"><Gauge size={21} /></span>
                  <div><small>ATMOSPHERIC CONTEXT</small><h3>NWS</h3><p>{data.providers.nws.role}</p></div>
                  <span className="platform-provider-card__status"><CheckCircle2 size={14} /> Available</span>
                </article>
                <article className={`platform-provider-card panel platform-provider-card--${providerTone(data.providers.deepseek.configured)}`}>
                  <span className="platform-provider-card__icon"><BrainCircuit size={21} /></span>
                  <div><small>OPTIONAL EXPLANATION</small><h3>DeepSeek</h3><p>{data.providers.deepseek.role}</p></div>
                  <span className="platform-provider-card__status">{data.providers.deepseek.configured ? <CheckCircle2 size={14} /> : <Activity size={14} />}{data.providers.deepseek.configured ? 'Configured' : 'Optional'}</span>
                </article>
                <article className={`platform-provider-card panel platform-provider-card--${providerTone(mapsConfigured)}`}>
                  <span className="platform-provider-card__icon"><MapPin size={21} /></span>
                  <div><small>SPATIAL EXPERIENCE</small><h3>Google Maps</h3><p>Satellite context, site geometry, worker positions and thermal overlays.</p></div>
                  <span className="platform-provider-card__status">{mapsConfigured ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{mapsConfigured ? 'Configured' : 'Needs client key'}</span>
                </article>
              </div>
            </section>

            <section className="platform-readiness-section">
              <div className="platform-readiness-section__head"><div><span className="platform-readiness-eyebrow">WORKSPACE FOUNDATION</span><h2>Operational data coverage</h2></div></div>
              <div className="platform-workspace-grid">
                <article className="panel"><MapPin size={19} /><span>Sites</span><strong>{data.workspace.siteCount}</strong><small>{data.workspace.boundaryReadySiteCount} boundary-ready</small></article>
                <article className="panel"><Users size={19} /><span>Workers</span><strong>{data.workspace.workerCount}</strong><small>Across configured sites</small></article>
                <article className="panel"><Layers3 size={19} /><span>Operational zones</span><strong>{data.workspace.zoneCount}</strong><small>{data.workspace.approvedZoneCount} approved</small></article>
                <article className="panel"><ShieldCheck size={19} /><span>Evidence policy</span><strong>{data.productionSafeDataMode ? 'Verified-first' : 'Fixture mode'}</strong><small>No synthetic spatial heat in production mode</small></article>
              </div>
            </section>

            <section className="platform-readiness-section">
              <div className="platform-readiness-section__head"><div><span className="platform-readiness-eyebrow">MODULE READINESS</span><h2>One intelligence core, four operating contexts</h2></div></div>
              <div className="platform-module-grid">
                {moduleRows.map(({ key, title, route, purpose, readiness }) => (
                  <article key={key} className={`platform-module-card panel${readiness.ready ? ' platform-module-card--ready' : ''}`}>
                    <div className="platform-module-card__head"><span>{readiness.ready ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span><small>{statusLabel(readiness.status)}</small></div>
                    <h3>{title}</h3>
                    <p>{purpose}</p>
                    <div className="platform-module-card__detail">{readiness.detail}</div>
                    <Link to={route}>Open module <ArrowRight size={14} /></Link>
                  </article>
                ))}
              </div>
            </section>

            <section className="platform-readiness-bottom-grid">
              <article className="platform-readiness-checklist panel">
                <div className="platform-readiness-section__head"><div><span className="platform-readiness-eyebrow">ATTENTION QUEUE</span><h2>What needs action</h2></div></div>
                {data.warnings.length ? (
                  <div className="platform-warning-list">
                    {data.warnings.map((warning) => <div key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>)}
                  </div>
                ) : (
                  <div className="platform-readiness-clear"><CheckCircle2 size={22} /><div><strong>Core prerequisites are clear</strong><span>Continue to the relevant module and verify the evidence timestamp before acting.</span></div></div>
                )}
                <div className="platform-readiness-shortcuts">
                  <Link to="/sites">Manage site boundaries <ArrowRight size={13} /></Link>
                  <Link to="/workers/new">Add workforce context <ArrowRight size={13} /></Link>
                  <Link to="/historical-intelligence">Run historical analysis <ArrowRight size={13} /></Link>
                </div>
              </article>

              <article className="platform-decision-pipeline panel">
                <div className="platform-readiness-section__head"><div><span className="platform-readiness-eyebrow">DECISION PIPELINE</span><h2>How HeatShield should act</h2></div></div>
                <div className="platform-pipeline-list">
                  <div><span>1</span><div><strong>Verified evidence</strong><small>FortyGuard spatial heat + official environmental context.</small></div></div>
                  <div><span>2</span><div><strong>Deterministic analysis</strong><small>Hotspots, exposure, thresholds and domain rules are computed first.</small></div></div>
                  <div><span>3</span><div><strong>Operational options</strong><small>Compare now, better time, better place or intervention priority.</small></div></div>
                  <div><span>4</span><div><strong>Explain &amp; approve</strong><small>AI can explain evidence-backed decisions; humans retain operational control.</small></div></div>
                </div>
              </article>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
