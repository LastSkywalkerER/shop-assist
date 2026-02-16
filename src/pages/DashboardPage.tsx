import { useNavigate } from 'react-router-dom'
import { Dashboard } from '../components/dashboard/Dashboard'
import { TabBar } from '../components/layout/TabBar'

export function DashboardPage() {
  const navigate = useNavigate()

  const handleTabChange = (tab: 'products' | 'expenses' | 'settings') => {
    if (tab === 'expenses') {
      navigate('/expenses')
    } else if (tab === 'settings') {
      navigate('/settings')
    }
  }

  return (
    <>
      <Dashboard />
      <TabBar activeTab="products" onTabChange={handleTabChange} />
    </>
  )
}
