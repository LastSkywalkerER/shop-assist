import { useNavigate } from 'react-router-dom'
import { Dashboard } from '../components/dashboard/Dashboard'
import { TabBar } from '../components/layout/TabBar'

export function DashboardPage() {
  const navigate = useNavigate()

  const handleTabChange = (tab: 'products' | 'expenses') => {
    if (tab === 'expenses') {
      navigate('/expenses')
    }
  }

  return (
    <>
      <Dashboard />
      <TabBar activeTab="products" onTabChange={handleTabChange} />
    </>
  )
}
