import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CloudSun,
  Database,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  ThermometerSun,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppShell } from '../components/layout/AppShell'
import { Topbar } from '../components/layout/Topbar'
import { api, type ConfigStatus } from '../lib/api'

function StatusBadge({ ready, label }: { ready: boolean; label?: string }) {
  return (
    <span className={`settings-status ${ready ? 'settings-status--ready' : 'settings-status--attention'}`}>
      {ready ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {label ?? (ready ? 'Ready' : 'Needs attention')}
    </span>
  )
}

export function SettingsPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.getConfigStatus(controller.signal)
      .then(setStatus)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Could not read runtime configuration.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [refreshKey])

  const coreReady = Boolean(status?.fortyguardConfigured && status?.nwsFallbackEnabled)

  return (
    <AppShell>
      <Topbar
        pageTitle="Settings"
        pageSubtitle="Runtime readiness, provider strategy and data-integrity controls for HeatShield."
        showSiteSelector={false}
        showAddSite={false}
        showObservation={false}
        showSearch={false}
        showNotifications={false}
        showPlanButton={false}
      />

      <div className="settings-page">
        <section className="settings-hero panel">
          <div className="settings-hero__icon"><ShieldCheck size={27} /></div>
          <div className="settings-hero__copy">
            <span className="settings-eyebrow">SYSTEM READINESS</span>
            <h2>Keep operational intelligence traceable and honest</h2>
            <p>HeatShield separates atmospheric conditions, spatial thermal intelligence and AI planning. This page shows configuration state only; secret API keys are never returned to the browser.</p>
          </div>
          <div className="settings-hero__state">
            {loading ? <span className="settings-status settings-status--loading"><RefreshCw className="settings-spin" size={14} /> Checking</span> : <StatusBadge ready={coreReady} label={coreReady ? 'Core stack ready' : 'Review integrations'} />}
            <button type="button" className="button button--secondary" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
              <RefreshCw size={15} /> Refresh status
            </button>
          </div>
        </section>

        {error && (
          <div className="settings-error panel"><AlertTriangle size={19} /><div><strong>Configuration status unavailable</strong><p>{error}</p></div></div>
        )}

        <div className="settings-grid">
          <section className="settings-card panel">
            <div className="settings-card__heading"><div className="settings-card__icon settings-card__icon--teal"><ThermometerSun size={20} /></div><div><span>PRIMARY THERMAL PROVIDER</span><h3>FortyGuard</h3></div>{status && <StatusBadge ready={status.fortyguardConfigured} />}</div>
            <p>Used for site thermal tiles, spatial temperature differences and the Thermal Explorer. HeatShield does not invent spatial hotspots when tiles are unavailable.</p>
            <dl>
              <div><dt>API configuration</dt><dd>{status?.fortyguardConfigured ? 'Configured server-side' : 'Missing server-side key'}</dd></div>
              <div><dt>Provider endpoint</dt><dd>{status?.fortyguardBaseUrl ?? '—'}</dd></div>
              <div><dt>Failure behavior</dt><dd>NWS conditions fallback; no synthetic heatmap</dd></div>
            </dl>
          </section>

          <section className="settings-card panel">
            <div className="settings-card__heading"><div className="settings-card__icon settings-card__icon--blue"><CloudSun size={20} /></div><div><span>ATMOSPHERIC FALLBACK</span><h3>National Weather Service</h3></div>{status && <StatusBadge ready={status.nwsFallbackEnabled} />}</div>
            <p>Provides official current atmospheric observations for US sites when FortyGuard thermal cells are temporarily unavailable.</p>
            <dl>
              <div><dt>Fallback enabled</dt><dd>{status?.nwsFallbackEnabled ? 'Yes' : 'No'}</dd></div>
              <div><dt>Provider endpoint</dt><dd>{status?.nwsBaseUrl ?? '—'}</dd></div>
              <div><dt>Scope</dt><dd>Temperature, humidity, heat index and wind</dd></div>
            </dl>
          </section>

          <section className="settings-card panel">
            <div className="settings-card__heading"><div className="settings-card__icon settings-card__icon--violet"><BrainCircuit size={20} /></div><div><span>PLAN INTELLIGENCE</span><h3>DeepSeek</h3></div>{status && <StatusBadge ready={status.deepseekConfigured} label={status.deepseekConfigured ? 'Configured' : 'Optional'} />}</div>
            <p>AI assistance is constrained by verified site conditions and deterministic worker-risk inputs. HeatShield remains usable without an AI provider.</p>
            <dl>
              <div><dt>Server configuration</dt><dd>{status?.deepseekConfigured ? 'Configured' : 'Not configured'}</dd></div>
              <div><dt>Decision policy</dt><dd>Facts first, AI explanation second</dd></div>
              <div><dt>Fallback</dt><dd>Deterministic worker-specific plan engine</dd></div>
            </dl>
          </section>

          <section className="settings-card panel">
            <div className="settings-card__heading"><div className="settings-card__icon settings-card__icon--orange"><Database size={20} /></div><div><span>DATA INTEGRITY</span><h3>Runtime mode</h3></div>{status && <StatusBadge ready={!status.fixturesEnabled} label={status.fixturesEnabled ? 'Fixtures enabled' : 'Real-data mode'} />}</div>
            <p>Production-facing screens should never silently substitute fixtures for provider observations. Runtime mode is exposed here so demos remain auditable.</p>
            <dl>
              <div><dt>Environment</dt><dd>{status?.environment ?? '—'}</dd></div>
              <div><dt>Fixture data</dt><dd>{status?.fixturesEnabled ? 'Enabled' : 'Disabled'}</dd></div>
              <div><dt>Browser secrets</dt><dd>Not exposed</dd></div>
            </dl>
          </section>
        </div>

        <section className="settings-strategy panel">
          <div className="settings-strategy__heading"><ServerCog size={20} /><div><span className="settings-eyebrow">PROVIDER STRATEGY</span><h3>How HeatShield decides what can be shown</h3></div></div>
          <div className="settings-flow" aria-label="HeatShield provider decision flow">
            <div><strong>1</strong><span>FortyGuard thermal request</span><small>Spatial site intelligence</small></div>
            <i>→</i>
            <div><strong>2</strong><span>Verified cells available?</span><small>Use actual thermal geometry only</small></div>
            <i>→</i>
            <div><strong>3</strong><span>NWS fallback if needed</span><small>Atmospheric conditions only</small></div>
            <i>→</i>
            <div><strong>4</strong><span>Worker-specific plan</span><small>Source-aware operational controls</small></div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
