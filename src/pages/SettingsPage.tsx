import { AppInfoSection } from '../components/settings/AppInfoSection'
import { SyncSection } from '../components/settings/SyncSection'
import { RoomsSection } from '../components/settings/RoomsSection'
import { BackupSection } from '../components/settings/BackupSection'

export function SettingsPage() {
  return (
    <div className="overflow-y-auto flex-1 px-4 pb-6 pt-2">
      <SyncSection />
      <RoomsSection />
      <BackupSection />
      <AppInfoSection />
    </div>
  )
}
