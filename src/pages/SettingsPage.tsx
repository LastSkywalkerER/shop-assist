import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppInfoSection } from '../components/settings/AppInfoSection'
import { SyncSection } from '../components/settings/SyncSection'
import { LinkedProvidersSection } from '../components/settings/LinkedProvidersSection'
import { NotificationChannelsSection } from '../components/settings/NotificationChannelsSection'
import { RoomsSection } from '../components/settings/RoomsSection'
import { BackupSection } from '../components/settings/BackupSection'
import { showBackButton } from '../telegram/backButton'

export function SettingsPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  return (
    <div className="overflow-y-auto flex-1 pb-8">
      <SyncSection />
      <LinkedProvidersSection />
      <NotificationChannelsSection />
      <RoomsSection />
      <BackupSection />
      <AppInfoSection />
    </div>
  )
}
