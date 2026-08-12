import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExpenseGroupsList } from '../components/groups/ExpenseGroupsList'
import { showBackButton } from '../telegram/backButton'

export function ExpenseGroupsPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  return <ExpenseGroupsList />
}
