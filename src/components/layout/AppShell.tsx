import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Header } from './Header'
import { UpdatePrompt } from './UpdatePrompt'
import { useUpdatePrompt } from '../../pwa/useUpdatePrompt'
import { useCity } from '../../config/CityContext'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { needRefresh, offlineReady, applyUpdate, dismissUpdate } = useUpdatePrompt()
  const { city, setCity } = useCity()
  const location = useLocation()

  return (
    <div className="h-dvh flex flex-col bg-bg-secondary">
      <UpdatePrompt
        needRefresh={needRefresh}
        offlineReady={offlineReady}
        onUpdate={applyUpdate}
        onDismiss={dismissUpdate}
      />
      <Header city={city} onCityChange={setCity} />
      <main key={location.pathname} className="flex-1 flex flex-col min-h-0 overflow-clip animate-page-enter">
        {children}
      </main>
    </div>
  )
}
