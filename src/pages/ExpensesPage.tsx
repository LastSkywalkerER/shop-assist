import { useNavigate } from 'react-router-dom'
import { ExpensesDashboard } from '../components/expenses/ExpensesDashboard'
import { TabBar } from '../components/layout/TabBar'

export function ExpensesPage() {
  const navigate = useNavigate()

  const handleTabChange = (tab: 'products' | 'expenses' | 'shopping-list') => {
    if (tab === 'products') {
      navigate('/products')
    } else if (tab === 'shopping-list') {
      navigate('/shopping-list')
    }
  }

  return (
    <>
      <ExpensesDashboard />
      <TabBar activeTab="expenses" onTabChange={handleTabChange} />
    </>
  )
}
