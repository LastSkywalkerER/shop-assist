import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AddPurchase } from '../components/purchase/AddPurchase'
import { showBackButton } from '../telegram/backButton'

export function AddPurchasePage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate('/'))
  }, [navigate])

  return <AddPurchase />
}
