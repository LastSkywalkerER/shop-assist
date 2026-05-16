import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ConfirmModal } from '../components/shared/ConfirmModal'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface ConfirmContextType {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const ConfirmDialogContext = createContext<ConfirmContextType | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    setOptions(null)
    resolverRef.current?.(value)
    resolverRef.current = null
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false)
      resolverRef.current = resolve
      setOptions(opts)
    })
  }, [])

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}
      {options && (
        <ConfirmModal
          title={options.title}
          message={options.message}
          confirmLabel={options.confirmLabel}
          cancelLabel={options.cancelLabel}
          destructive={options.destructive}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmDialogContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmDialogProvider')
  return ctx.confirm
}
