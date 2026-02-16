import { useNavigate } from 'react-router-dom'
import { ExpensesDashboard } from '../components/expenses/ExpensesDashboard'
import { TabBar } from '../components/layout/TabBar'

export function ExpensesPage() {
  const navigate = useNavigate()

  const handleTabChange = (tab: 'products' | 'expenses' | 'settings') => {
    if (tab === 'products') {
      navigate('/')
    } else if (tab === 'settings') {
      navigate('/settings')
    }
  }

  return (
    <>
      <ExpensesDashboard />
      <TabBar activeTab="expenses" onTabChange={handleTabChange} />
    </>
  )
}
