import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnalyticsDashboard } from '../components/analytics/AnalyticsDashboard'
import { showBackButton } from '../telegram/backButton'

export function AnalyticsPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  return <AnalyticsDashboard />
}
