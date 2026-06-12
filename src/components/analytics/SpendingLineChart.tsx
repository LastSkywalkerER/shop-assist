import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from 'recharts'
import { BASE_CURRENCY } from '../../lib/currency/convert'
import type { Granularity, SeriesPoint } from '../../lib/analytics/aggregate'

interface SpendingLineChartProps {
  series: SeriesPoint[]
  granularity: Granularity
  average: number
  maxKey: string | null
}

const fmt = (n: number) => `${n.toFixed(2)} ${BASE_CURRENCY}`

export function SpendingLineChart({ series, granularity, average, maxKey }: SpendingLineChartProps) {
  const isMonthly = granularity === 'month'
  const maxPoint = maxKey ? series.find((p) => p.key === maxKey) : undefined
  const hasData = series.some((p) => p.total > 0)

  return (
    <div className="bg-surface rounded-2xl p-4">
      <h3 className="text-[15px] font-semibold text-text">
        {isMonthly ? 'Расходы по месяцам' : 'Расходы по дням'}, {BASE_CURRENCY}
      </h3>
      {hasData ? (
        <>
          <p className="text-[12px] text-text-hint mt-0.5">
            В среднем {fmt(average)} {isMonthly ? 'в месяц' : 'в день'}
            {maxPoint && (
              <>
                {' · '}
                <span className="text-destructive font-medium">
                  максимум: {maxPoint.label} — {fmt(maxPoint.total)}
                </span>
              </>
            )}
          </p>
          <div className="h-56 mt-3 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                  formatter={(value) => [fmt(Number(value)), 'Расходы']}
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
                <ReferenceLine
                  y={average}
                  stroke="var(--color-text-hint)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {maxPoint && (
                  <ReferenceDot
                    x={maxPoint.label}
                    y={maxPoint.total}
                    r={5}
                    fill="var(--color-destructive)"
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="py-6 text-center text-[13px] text-text-hint">Нет данных за период</div>
      )}
    </div>
  )
}
