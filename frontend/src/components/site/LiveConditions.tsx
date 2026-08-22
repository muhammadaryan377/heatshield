import { Info } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SiteIntelligence } from '../../types/site'

interface LiveConditionsProps {
  data: SiteIntelligence
}

export function LiveConditions({ data }: LiveConditionsProps) {
  return (
    <article className="mini-card panel">
      <h3>Live Conditions</h3>
      <div className="conditions-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.forecast} margin={{ top: 8, right: 5, bottom: 0, left: -27 }}>
            <defs>
              <linearGradient id="heatFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f3784b" stopOpacity={0.20} />
                <stop offset="100%" stopColor="#f3784b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#68757c' }} interval={1} />
            <YAxis domain={['dataMin - 2', 'dataMax + 2']} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#68757c' }} />
            <Tooltip cursor={{ stroke: '#8fa7a7', strokeDasharray: '3 3' }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
            <Area type="monotone" dataKey="temperatureC" stroke="#ef6548" strokeWidth={2} fill="url(#heatFill)" dot={{ r: 2, fill: '#fff', stroke: '#ef6548' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="feels-like-row">
        <span>Feels like <strong>{data.conditions.feelsLikeC.toFixed(1)}°C</strong></span>
        <Info size={14} />
      </div>
      <div className="mini-card__meta">Wind: {data.conditions.windKph.toFixed(0)} km/h <span>•</span> {data.conditions.windDirection}</div>
    </article>
  )
}
