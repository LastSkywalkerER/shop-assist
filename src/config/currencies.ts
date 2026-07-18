export interface Currency {
  code: string
  symbol: string
}

export const CURRENCIES: Currency[] = [
  { code: 'BYN', symbol: 'Br' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'RUB', symbol: '₽' },
  { code: 'PLN', symbol: 'zł' },
  { code: 'UAH', symbol: '₴' },
  { code: 'IDR', symbol: 'Rp' },
  { code: 'HUF', symbol: 'Ft' },
  { code: 'RSD', symbol: 'din' },
  { code: 'BAM', symbol: 'KM' },
  { code: 'CZK', symbol: 'Kč' },
]

export const DEFAULT_CURRENCY = 'BYN'

export function getCurrencySymbol(code: string): string {
  return CURRENCIES.find(c => c.code === code)?.symbol || code
}
