import { useMemo } from 'react'
import { useRxCollection, useRxQuery } from '../../db/hooks'
import type { CurrencyRateDocument } from '../../db/types'

export function CurrencyRateIndicator() {
  const collection = useRxCollection<CurrencyRateDocument>('currencyRates')
  const query = useMemo(
    () => ({
      selector: { currency: 'USD' },
      sort: [{ date: 'desc' as const }],
      limit: 8,
    }),
    [],
  )
  const { data } = useRxQuery<CurrencyRateDocument>(collection, query)

  if (!data || data.length === 0) return null

  const today = data[0]
  const prev = data[data.length - 1]
  const diff = today.rate - prev.rate

  let arrow = '→'
  let color = 'text-text-hint'
  if (diff > 0.001) {
    arrow = '↗'
    color = 'text-red-500'
  } else if (diff < -0.001) {
    arrow = '↘'
    color = 'text-green-500'
  }

  const formatted = today.rate.toFixed(2)
  const [, month, day] = today.date.split('-')
  const shortDate = day && month ? `${day}.${month}` : ''
  const title = `USD → BYN: ${today.rate.toFixed(4)} on ${today.date}`
    + (data.length > 1 ? ` (${diff >= 0 ? '+' : ''}${diff.toFixed(4)} vs ${prev.date})` : '')

  return (
    <span
      className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-bg-secondary/40 text-text text-[12px] font-medium tabular-nums shrink-0"
      title={title}
    >
      <span className="text-text-hint">$</span>
      <span>{formatted}</span>
      <span className={color}>{arrow}</span>
      {shortDate && <span className="text-text-hint ml-1">{shortDate}</span>}
    </span>
  )
}
