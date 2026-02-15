import { useState, useCallback } from 'react'
import { type City, getSavedCity, saveCity } from '../config/cities'

export function useCitySelect() {
  const [city, setCity] = useState<City>(getSavedCity)

  const select = useCallback((c: City) => {
    setCity(c)
    saveCity(c)
  }, [])

  return { city, select }
}
