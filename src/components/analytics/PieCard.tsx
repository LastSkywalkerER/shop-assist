import { useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import type { PieDatum, StackedSeries, Granularity } from '../../lib/analytics/aggregate'
import { sliceColor } from './palette'

interface PieCardProps {
  title: string
  data: PieDatum[]
  valueFormatter: (value: number) => string
  emptyText?: string
  /** Same breakdown spread over time; enables the bar-chart view toggle. */
  bars?: StackedSeries
  barGranularity?: Granularity
}

type View = 'pie' | 'bars'

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const btn = (target: View, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(target)}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
        view === target ? 'bg-primary/15 text-primary-text' : 'text-text-hint active:bg-bg-secondary/50'
      }`}
    >
      {icon}
    </button>
  )
  return (
    <div className="flex gap-1 shrink-0">
      {btn(
        'pie',
        'Круговая диаграмма',
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
          <path d="M22 12A10 10 0 0 0 12 2v10z" />
        </svg>,
      )}
      {btn(
        'bars',
        'Столбчатая диаграмма',
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21V10" />
          <path d="M9 21V4" />
          <path d="M15 21v-9" />
          <path d="M21 21V7" />
        </svg>,
      )}
    </div>
  )
}

/**
 * Breakdown card: a donut with a legend list by default (recharts slice
 * labels overlap badly on a phone-width viewport), switchable to a stacked
 * bar chart over time when `bars` is provided. Bar segments reuse the pie
 * group order, so colors match between the two views and the legend.
 */
export function PieCard({
  title,
  data,
  valueFormatter,
  emptyText = 'Нет данных за период',
  bars,
  barGranularity,
}: PieCardProps) {
  const [view, setView] = useState<View>('pie')
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const showBars = view === 'bars' && bars != null

  // Flat rows for recharts with index-based keys ('v0'…) so a group named
  // «label» can never collide with the axis field.
  const barRows = showBars
    ? bars.points.map((p) => ({
        label: p.label,
        ...Object.fromEntries(p.values.map((v, i) => [`v${i}`, v])),
      }))
    : []

  const legend = (
    <div className="flex-1 min-w-0 space-y-1.5">
      {data.map((d, i) => (
        <div key={d.name} className="flex items-center gap-2 text-[12px]">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: sliceColor(d.name, i) }}
          />
          <span className="text-text truncate flex-1 min-w-0">{d.name}</span>
          <span className="text-text-hint tabular-nums shrink-0">
            {valueFormatter(d.value)} · {Math.round((d.value / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="bg-surface rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        {bars != null && data.length > 0 && total > 0 && (
          <ViewToggle view={view} onChange={setView} />
        )}
      </div>
      {data.length === 0 || total <= 0 ? (
        <div className="py-6 text-center text-[13px] text-text-hint">{emptyText}</div>
      ) : showBars ? (
        <>
          <p className="text-[12px] text-text-hint mt-0.5">
            {barGranularity === 'day' ? 'По дням' : 'По месяцам'}
          </p>
          <div className="h-48 mt-3 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-separator)" strokeOpacity={0.4} vertical={false} />
                <XAxis
                  dataKey="label"
                  interval="preserveStartEnd"
                  minTickGap={24}
                  tick={{ fill: 'var(--color-text-hint)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-separator)' }}
                />
                <YAxis
                  width={44}
                  tick={{ fill: 'var(--color-text-hint)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value, name) => [valueFormatter(Number(value)), String(name)]}
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: 'none',
                    borderRadius: 12,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    color: 'var(--color-text)',
                    fontSize: 12,
                  }}
                  itemStyle={{ color: 'var(--color-text)' }}
                  labelStyle={{ color: 'var(--color-text-hint)' }}
                />
                {bars.names.map((name, i) => (
                  <Bar
                    key={name}
                    dataKey={`v${i}`}
                    name={name}
                    stackId="total"
                    fill={sliceColor(name, i)}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">{legend}</div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <div className="shrink-0">
            <PieChart width={140} height={140}>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={40}
                outerRadius={66}
                strokeWidth={0}
                isAnimationActive={false}
              >
                {data.map((d, i) => (
                  <Cell key={d.name} fill={sliceColor(d.name, i)} />
                ))}
              </Pie>
            </PieChart>
          </div>
          {legend}
        </div>
      )}
    </div>
  )
}
