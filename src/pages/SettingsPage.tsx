import { AppInfoSection } from '../components/settings/AppInfoSection'
import { SyncSection } from '../components/settings/SyncSection'
import { RoomsSection } from '../components/settings/RoomsSection'
import { BackupSection } from '../components/settings/BackupSection'

export function SettingsPage() {
  return (
    <div className="overflow-y-auto flex-1 pb-8">
      <SyncSection />
      <RoomsSection />
      <BackupSection />
      <AppInfoSection />
    </div>
  )
}
