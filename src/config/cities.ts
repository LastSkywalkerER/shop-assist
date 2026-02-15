export interface City {
  id: string
  name: string
  lat: number
  lon: number
  radius: number // meters for Overpass "around"
}

export const CITIES: City[] = [
  { id: 'minsk', name: 'Минск', lat: 53.9, lon: 27.5667, radius: 20000 },
  { id: 'brest', name: 'Брест', lat: 52.0976, lon: 23.7341, radius: 12000 },
  { id: 'gomel', name: 'Гомель', lat: 52.4345, lon: 30.9754, radius: 12000 },
  { id: 'grodno', name: 'Гродно', lat: 53.6884, lon: 23.8258, radius: 12000 },
  { id: 'mogilev', name: 'Могилёв', lat: 53.9045, lon: 30.3449, radius: 12000 },
  { id: 'vitebsk', name: 'Витебск', lat: 55.1904, lon: 30.2049, radius: 12000 },
]

export const DEFAULT_CITY = CITIES[0] // Минск

const STORAGE_KEY = 'shop-assist-city'

export function getSavedCity(): City {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    if (id) {
      const found = CITIES.find((c) => c.id === id)
      if (found) return found
    }
  } catch {}
  return DEFAULT_CITY
}

export function saveCity(city: City) {
  try {
    localStorage.setItem(STORAGE_KEY, city.id)
  } catch {}
}
