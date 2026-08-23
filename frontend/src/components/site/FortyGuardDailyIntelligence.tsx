import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flame,
  Gauge,
  Layers3,
  LoaderCircle,
  RefreshCw,
  ThermometerSun,
  TimerReset,
  TriangleAlert,
  UsersRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { FortyGuardDailyProfile, FortyGuardLayerStatus, Site } from '../../types/site'

interface FortyGuardDailyIntelligenceProps {
  site: Site
}

type Granularity = 60 | 80 | 100

const lastCompleteDay = () => {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

function metric(value: number | null | undefined, suffix = '', digits = 1) {
  return value == null ? '—' : `${value.toFixed(digits)}${suffix}`
}

function layerName(layer: FortyGuardLayerStatus['analyticType']) {
  if (layer === 'tcm') return 'TCM thermal'
  if (layer === 'time_of_measure') return 'Peak timing'
  if (layer === 'exceedance') return 'Exceedance'
  return 'Persistence'
}

function LayerBadge({ layer }: { layer: FortyGuardLayerStatus }) {
  const activity = layer.activityId ? ` · activity ${layer.activityId.slice(0, 8)}…` : ''
  return (
    <div className={`fg-layer fg-layer--${layer.status}`}>
      <span>{layer.status === 'verified' ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}</span>
      <div>
        <strong>{layerName(layer.analyticType)}</strong>
        <small>{layer.status === 'verified' ? `${layer.cellCount} cells${layer.units ? ` · ${layer.units}` : ''}${activity}` : `Unavailable${activity}`}</small>
      </div>
    </div>
  )
}

export function FortyGuardDailyIntelligence({ site }: FortyGuardDailyIntelligenceProps) {
  const [studyDate, setStudyDate] = useState(lastCompleteDay)
  const [thresholdC, setThresholdC] = useState(30)
  const [granularity, setGranularity] = useState<Granularity>(100)
  const [profile, setProfile] = useState<FortyGuardDailyProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setProfile(null)
    setError(null)
    setStudyDate(lastCompleteDay())
  }, [site.id])

  const completeWorkers = useMemo(
    () => profile?.workers.filter((worker) => worker.evidenceStatus === 'complete').length ?? 0,
    [profile],
  )

  const runProfile = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.generateFortyGuardProfile(site.id, {
        date: studyDate,
        thresholdC,
        granularityMeters: granularity,
      })
      setProfile(result)
      if (result.dataStatus === 'configuration_required' || result.dataStatus === 'unavailable') {
        setError(result.message ?? 'FortyGuard did not return a usable daily profile for this date.')
      }
    } catch (err) {
      setProfile(null)
      setError(err instanceof Error ? err.message : 'Could not generate the FortyGuard profile.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="fg-intelligence panel">
      <div className="fg-intelligence__header">
        <div>
          <span className="fg-intelligence__eyebrow"><Flame size={14} /> FORTYGUARD INTELLIGENCE ENGINE</span>
          <h2>Completed-day site heat profile</h2>
          <p>Use real FortyGuard TCM, peak timing, exceedance and persistence layers to measure where heat peaks, when it peaks, and how long each area stays above the selected threshold. Worker coordinates are joined to the provider cells they occupy.</p>
        </div>
        <div className="fg-provider-chip"><span>FG</span><div><strong>FortyGuard</strong><small>Primary thermal evidence</small></div></div>
      </div>

      <div className="fg-controls">
        <label>
          <span><CalendarDays size={14} /> Analysis date</span>
          <input type="date" min="2019-01-01" max={lastCompleteDay()} value={studyDate} onChange={(event) => { setStudyDate(event.target.value); setProfile(null) }} />
        </label>
        <label>
          <span><Gauge size={14} /> Heat threshold</span>
          <div className="fg-control-with-unit"><input type="number" min={-30} max={70} step={0.5} value={thresholdC} onChange={(event) => { setThresholdC(Number(event.target.value)); setProfile(null) }} /><b>°C</b></div>
        </label>
        <label>
          <span><Layers3 size={14} /> Spatial resolution</span>
          <select value={granularity} onChange={(event) => { setGranularity(Number(event.target.value) as Granularity); setProfile(null) }}>
            <option value={60}>60 m · detailed</option>
            <option value={80}>80 m · balanced</option>
            <option value={100}>100 m · efficient</option>
          </select>
        </label>
        <button type="button" className="button button--primary fg-run" onClick={() => void runProfile()} disabled={loading || !studyDate}>
          {loading ? <LoaderCircle className="fg-spin" size={17} /> : profile ? <RefreshCw size={17} /> : <Activity size={17} />}
          {loading ? 'Running 4 FortyGuard layers…' : profile ? 'Run Again' : 'Analyze with FortyGuard'}
        </button>
      </div>

      {!profile && !loading && !error && (
        <div className="fg-ready-state">
          <div className="fg-ready-state__icon"><Activity size={23} /></div>
          <div>
            <strong>Ready to build a provider-backed daily profile</strong>
            <p>The default is yesterday, the latest complete day. One run requests four real FortyGuard layers and exposes their activity IDs so the evidence is traceable.</p>
          </div>
          <div className="fg-ready-state__flow"><span>TCM</span><i>→</i><span>Peak time</span><i>→</i><span>Duration</span><i>→</i><span>Workers</span></div>
        </div>
      )}

      {error && (
        <div className="fg-alert">
          <TriangleAlert size={18} />
          <div><strong>FortyGuard profile not fully available</strong><p>{error}</p></div>
        </div>
      )}

      {profile && profile.dataStatus !== 'configuration_required' && (
        <>
          <div className="fg-profile-meta">
            <div><span className={`fg-status-dot fg-status-dot--${profile.dataStatus}`} /> <strong>{profile.dataStatus === 'verified' ? 'Verified daily profile' : profile.dataStatus === 'partial' ? 'Partially verified profile' : 'Profile unavailable'}</strong></div>
            <span>{profile.date} · {profile.timezoneName}</span>
            <span>{profile.cached ? 'Cached result · no new provider requests' : `${profile.providerRequestCount} provider request${profile.providerRequestCount === 1 ? '' : 's'}`}</span>
          </div>

          <div className="fg-layer-grid">
            {profile.layers.map((layer) => <LayerBadge key={layer.analyticType} layer={layer} />)}
          </div>

          {profile.tcmCellCount > 0 && (
            <div className="fg-metrics">
              <article><span><ThermometerSun size={17} /> Site peak</span><strong>{metric(profile.maxTemperatureC, '°C')}</strong><small>{profile.tcmCellCount} TCM cells</small></article>
              <article><span><Clock3 size={17} /> Peak window</span><strong>{profile.peakHourLocal ?? '—'}</strong><small>{profile.peakHourUtc != null ? `${String(profile.peakHourUtc).padStart(2, '0')}:00 UTC` : 'Peak timing layer pending'}</small></article>
              <article><span><TimerReset size={17} /> Max above {profile.thresholdC.toFixed(1)}°C</span><strong>{metric(profile.maxHoursAboveThreshold, ' h')}</strong><small>Measured exceedance duration</small></article>
              <article><span><Flame size={17} /> Longest hot run</span><strong>{metric(profile.maxPersistenceHours, ' h')}</strong><small>Continuous persistence</small></article>
              <article><span><Gauge size={17} /> Site mean peak</span><strong>{metric(profile.meanTemperatureC, '°C')}</strong><small>{metric(profile.minTemperatureC, '°C')} coolest cell</small></article>
              <article><span><UsersRound size={17} /> Worker evidence</span><strong>{completeWorkers}/{profile.workers.length}</strong><small>Complete spatial joins</small></article>
            </div>
          )}

          {profile.workers.length > 0 && (
            <div className="fg-workers">
              <div className="fg-workers__header"><div><strong>Worker-specific FortyGuard exposure</strong><span>Each row is joined by the worker’s saved map coordinate, not by a site-wide average.</span></div></div>
              <div className="fg-worker-table-wrap">
                <table className="fg-worker-table">
                  <thead><tr><th>Worker</th><th>Area</th><th>Peak tile</th><th>Peak time</th><th>Above threshold</th><th>Persistence</th><th>Evidence</th></tr></thead>
                  <tbody>
                    {profile.workers.map((worker) => (
                      <tr key={worker.workerId}>
                        <td><strong>{worker.workerName}</strong><span>{worker.role}</span></td>
                        <td>{worker.area}</td>
                        <td>{metric(worker.peakTemperatureC, '°C')}</td>
                        <td>{worker.peakHourLocal ?? '—'}</td>
                        <td>{metric(worker.hoursAboveThreshold, ' h')}</td>
                        <td>{metric(worker.persistenceHours, ' h')}</td>
                        <td><span className={`fg-evidence fg-evidence--${worker.evidenceStatus}`}>{worker.evidenceStatus}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {profile.message && <div className="fg-footnote"><CheckCircle2 size={16} /><span>{profile.message}</span></div>}
        </>
      )}
    </section>
  )
}
