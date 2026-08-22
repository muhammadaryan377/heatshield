import { CloudOff, Info } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SiteIntelligence } from '../../types/site'

interface LiveConditionsProps {
  data: SiteIntelligence
}

export function LiveConditions({ data }: LiveConditionsProps) {
  if (!data.conditions) {
    return (
      <article className="mini-card panel mini-card--empty">
        <h3>Live Conditions</h3>
        <div className="mini-data-empty"><CloudOff size={22} /><strong>No live observation</strong><p>Temperature, humidity and heat index will appear only after FortyGuard returns verified data for this site.</p></div>
      </article>
    )
  }

  return (
    <article className="mini-card panel">
      <h3>Live Conditions</h3>
      {data.forecast.length > 1 ? (
        <div className="conditions-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.forecast} margin={{ top: 8, right: 5, bottom: 0, left: -27 }}>
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#68757c' }} interval={1} />
              <YAxis domain={['dataMin - 2', 'dataMax + 2']} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#68757c' }} />
              <Tooltip cursor={{ stroke: '#8fa7a7', strokeDasharray: '3 3' }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Area type="monotone" dataKey="temperatureC" stroke="#ef6548" strokeWidth={2} fillOpacity={0.08} dot={{ r: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="single-live-reading"><strong>{data.conditions.temperatureC.toFixed(1)}°C</strong><span>Verified site temperature</span></div>
      )}
      <div className="feels-like-row"><span>Feels like <strong>{data.conditions.feelsLikeC.toFixed(1)}°C</strong></span><Info size={14} /></div>
      <div className="mini-card__meta">
        {data.conditions.windKph != null ? `Wind: ${data.conditions.windKph.toFixed(0)} km/h` : 'Wind data unavailable'}
        {data.conditions.windDirection ? ` • ${data.conditions.windDirection}` : ''}
      </div>
    </article>
  )
}
