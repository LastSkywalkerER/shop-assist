import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CategoriesManager } from '../components/categories/CategoriesManager'
import { showBackButton } from '../telegram/backButton'

export function CategoriesPage() {
  const navigate = useNavigate()

  useEffect(() => {
    return showBackButton(() => navigate(-1))
  }, [navigate])

  return <CategoriesManager />
}
