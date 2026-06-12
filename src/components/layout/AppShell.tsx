import type { ReactNode } from 'react'
import { Header } from './Header'
import { UpdatePrompt } from './UpdatePrompt'
import { useUpdatePrompt } from '../../pwa/useUpdatePrompt'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { needRefresh, offlineReady, applyUpdate, dismissUpdate } = useUpdatePrompt()

  return (
    <div className="h-dvh flex flex-col bg-bg-secondary">
      <UpdatePrompt
        needRefresh={needRefresh}
        offlineReady={offlineReady}
        onUpdate={applyUpdate}
        onDismiss={dismissUpdate}
      />
      <Header />
      <main className="flex-1 flex flex-col min-h-0">
        {children}
      </main>
    </div>
  )
}
