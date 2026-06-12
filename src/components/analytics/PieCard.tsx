import { PieChart, Pie, Cell } from 'recharts'
import type { PieDatum } from '../../lib/analytics/aggregate'
import { sliceColor } from './palette'

interface PieCardProps {
  title: string
  data: PieDatum[]
  valueFormatter: (value: number) => string
  emptyText?: string
}

/**
 * Donut chart with a legend list instead of slice labels — recharts labels
 * overlap badly on a phone-width viewport.
 */
export function PieCard({ title, data, valueFormatter, emptyText = 'Нет данных за период' }: PieCardProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="bg-surface rounded-2xl p-4">
      <h3 className="text-[15px] font-semibold text-text">{title}</h3>
      {data.length === 0 || total <= 0 ? (
        <div className="py-6 text-center text-[13px] text-text-hint">{emptyText}</div>
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
        </div>
      )}
    </div>
  )
}
