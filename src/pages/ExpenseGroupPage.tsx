import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExpenseGroupDetails } from '../components/groups/ExpenseGroupDetails'
import { showBackButton } from '../telegram/backButton'

export function ExpenseGroupPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  return <ExpenseGroupDetails />
}
