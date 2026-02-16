import { useNavigate } from 'react-router-dom'
import { ExpensesDashboard } from '../components/expenses/ExpensesDashboard'
import { TabBar } from '../components/layout/TabBar'

export function ExpensesPage() {
  const navigate = useNavigate()

  const handleTabChange = (tab: 'products' | 'expenses') => {
    if (tab === 'products') {
      navigate('/')
    }
  }

  return (
    <>
      <ExpensesDashboard />
      <TabBar activeTab="expenses" onTabChange={handleTabChange} />
    </>
  )
}
