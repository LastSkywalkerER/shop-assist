import { useState, useRef, useCallback } from 'react'
import { fetchPageMeta } from '../../lib/fetchMeta'

export interface UrlMeta {
  url: string
  title?: string
  description?: string
  image?: string
  favicon?: string
}

interface Props {
  value: UrlMeta | null
  onChange: (value: UrlMeta | null) => void
  label?: string
}

export function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function urlHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function UrlInput({ value, onChange, label = 'Ссылка на товар' }: Props) {
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [metaFailed, setMetaFailed] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchMeta = useCallback(async (url: string) => {
    setLoading(true)
    setMetaFailed(false)
    try {
      const meta = await fetchPageMeta(url)
      onChange({ url, title: meta.title, description: meta.description, image: meta.image, favicon: meta.favicon })
      setMetaFailed(!meta.title)
    } catch {
      onChange({ url })
      setMetaFailed(true)
    } finally {
      setLoading(false)
    }
  }, [onChange])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value)
    setValidationError(null)
  }

  const handleInputBlur = () => {
    const trimmed = inputText.trim()
    if (!trimmed) return
    if (!isValidUrl(trimmed)) {
      setValidationError('Введите ссылку, начинающуюся с https://')
      return
    }
    setEditing(false)
    fetchMeta(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') inputRef.current?.blur()
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim()
    if (isValidUrl(pasted)) {
      e.preventDefault()
      setInputText(pasted)
    }
  }

  const handleClear = () => {
    onChange(null)
    setInputText('')
    setValidationError(null)
    setMetaFailed(false)
    setEditing(false)
  }

  const handleEditClick = () => {
    setEditing(true)
    setMetaFailed(false)
    setInputText(value?.url ?? '')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleRetryMeta = () => {
    if (value?.url) fetchMeta(value.url)
  }

  // Show preview card if we have a loaded value and not in editing mode
  if (value && !editing) {
    const displayTitle = value.title || urlHostname(value.url)
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-[13px] text-section-header font-medium pl-1">{label}</label>
        <div className="bg-surface rounded-xl px-4 py-3 flex items-start gap-3">
          {loading ? (
            <div className="flex-1 flex items-center gap-2 py-1">
              <svg className="animate-spin w-4 h-4 text-primary shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span className="text-[13px] text-text-hint">Загружаем данные страницы...</span>
            </div>
          ) : (
            <>
              {value.favicon && (
                <img
                  src={value.favicon}
                  alt=""
                  className="w-5 h-5 rounded-sm object-contain shrink-0 mt-0.5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={value.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[14px] font-medium text-primary leading-snug line-clamp-2 underline-offset-2 hover:underline active:opacity-70 wrap-break-word"
                >
                  {displayTitle}
                </a>
                {value.description && (
                  <p className="text-[12px] text-text-hint mt-0.5 line-clamp-2 leading-snug">
                    {value.description}
                  </p>
                )}
                <span className="text-[11px] text-text-hint/50 mt-0.5 block truncate">
                  {urlHostname(value.url)}
                </span>
              </div>
              {value.image && (
                <img
                  src={value.image}
                  alt=""
                  className="w-14 h-14 rounded-lg object-cover shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
            </>
          )}
        </div>
        {metaFailed && !loading && (
          <p className="text-[11px] text-text-hint pl-1">
            Не удалось загрузить заголовок страницы.{' '}
            <button type="button" onClick={handleRetryMeta} className="text-primary underline-offset-1 underline">
              Повторить
            </button>
          </p>
        )}
        <div className="flex gap-2 pl-1">
          <button type="button" onClick={handleEditClick} className="text-[12px] text-primary active:opacity-60">
            Изменить
          </button>
          <span className="text-text-hint/40 text-[12px]">·</span>
          <button type="button" onClick={handleClear} className="text-[12px] text-destructive active:opacity-60">
            Удалить
          </button>
        </div>
      </div>
    )
  }

  // Input mode (no value set yet, or editing)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] text-section-header font-medium pl-1">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="url"
          value={inputText}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="https://..."
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={loading}
          className="w-full bg-surface rounded-xl px-4 py-3 text-[15px] text-text placeholder:text-text-hint/60 focus:ring-2 focus:ring-primary/30 transition-shadow pr-10 disabled:opacity-60"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        )}
        {!loading && inputText && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setInputText(''); setValidationError(null) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-hint/50 active:opacity-60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {validationError && (
        <p className="text-[12px] text-destructive pl-1">{validationError}</p>
      )}
    </div>
  )
}
