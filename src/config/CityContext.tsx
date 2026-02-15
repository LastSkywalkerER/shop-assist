import { createContext, useContext, type ReactNode } from 'react'
import { type City, DEFAULT_CITY } from './cities'
import { useCitySelect } from '../hooks/useCitySelect'

interface CityContextValue {
  city: City
  setCity: (city: City) => void
}

const CityCtx = createContext<CityContextValue>({
  city: DEFAULT_CITY,
  setCity: () => {},
})

export function CityProvider({ children }: { children: ReactNode }) {
  const { city, select } = useCitySelect()
  return (
    <CityCtx.Provider value={{ city, setCity: select }}>
      {children}
    </CityCtx.Provider>
  )
}

export function useCity() {
  return useContext(CityCtx)
}
