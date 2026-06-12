import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { SplitGroupsList } from '../components/expenses/SplitGroupsList'
import { showBackButton } from '../telegram/backButton'

export function SplitGroupsPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  return <SplitGroupsList />
}
