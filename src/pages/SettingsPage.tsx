import { useNavigate } from 'react-router-dom'
import { TabBar } from '../components/layout/TabBar'
import { AppInfoSection } from '../components/settings/AppInfoSection'
import { SyncSection } from '../components/settings/SyncSection'

export function SettingsPage() {
  const navigate = useNavigate()

  const handleTabChange = (tab: 'products' | 'expenses' | 'settings') => {
    if (tab === 'products') {
      navigate('/')
    } else if (tab === 'expenses') {
      navigate('/expenses')
    }
  }

  return (
    <>
      <div className="px-4 pb-20">
        <SyncSection />
        <AppInfoSection />
      </div>
      <TabBar activeTab="settings" onTabChange={handleTabChange} />
    </>
  )
}
