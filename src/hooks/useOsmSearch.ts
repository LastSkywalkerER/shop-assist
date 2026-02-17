import { useState, useEffect, useRef, useCallback } from 'react'
import type { City } from '../config/cities'

// Convert center + radius (meters) to a lon/lat viewbox string
function cityViewbox(city: City): string {
  const r = city.regionRadius || city.radius
  const latDelta = r / 111_320
  const lonDelta = r / (111_320 * Math.cos((city.lat * Math.PI) / 180))
  return `${city.lon - lonDelta},${city.lat + latDelta},${city.lon + lonDelta},${city.lat - latDelta}`
}

export interface OsmResult {
  osmId: string
  name: string
  address: string
  type: 'market' | 'store' | undefined
  source: 'nominatim' | 'overpass' | 'photon' | 'geoapify'
  lat: string
  lon: string
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function dedup(items: OsmResult[]): OsmResult[] {
  const seen = new Set<string>()
  return items.filter((r) => {
    const key = `${r.name.toLowerCase()}|${r.address.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function clientFilter(items: OsmResult[], filterWords: string[]): OsmResult[] {
  return items.filter((r) => {
    const searchable = `${r.name} ${r.address}`.toLowerCase()
    return filterWords.every((w) => searchable.includes(w))
  })
}

// ─── Nominatim ───
async function searchNominatim(
  apiQuery: string,
  city: City,
  signal: AbortSignal,
): Promise<OsmResult[]> {
  const params = new URLSearchParams({
    q: apiQuery,
    format: 'json',
    addressdetails: '1',
    namedetails: '1',
    limit: '15',
    'accept-language': 'ru',
    countrycodes: 'by',
    viewbox: cityViewbox(city),
    bounded: '1',
  })

  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { signal, headers: { 'User-Agent': 'ShopAssist/1.0' } },
  )
  if (!resp.ok) return []
  const data = await resp.json()

  return data
    .filter((item: any) => {
      if (!item.display_name) return false
      const addr = item.address ?? {}
      return addr.road && addr.house_number
    })
    .map((item: any) => {
      const addr = item.address ?? {}
      const c = addr.city || addr.town || addr.village
      const street = addr.road
      const house = addr.house_number
      const parts = [c, `${street}, ${house}`].filter(Boolean)

      const osmType = item.type
      let storeType: 'market' | 'store' | undefined
      if (['marketplace', 'market'].includes(osmType)) storeType = 'market'
      else if (
        ['supermarket', 'convenience', 'shop', 'department_store', 'mall', 'general'].includes(osmType) ||
        item.class === 'shop'
      ) storeType = 'store'

      return {
        osmId: `n-${item.osm_id}`,
        name: item.namedetails?.name || addr.shop || item.name || item.display_name.split(',')[0],
        address: parts.join(', ') || item.display_name.split(',').slice(0, 3).join(',').trim(),
        type: storeType,
        source: 'nominatim' as const,
        lat: item.lat,
        lon: item.lon,
      }
    })
}

// ─── Overpass: only nodes, small radius, short timeout, own AbortController ───
async function searchOverpass(
  nameQuery: string,
  city: City,
  signal: AbortSignal,
): Promise<OsmResult[]> {
  const escaped = escapeRegex(nameQuery)
  // Use moderate radius for Overpass (max 40km to avoid timeouts)
  const radius = Math.min(city.regionRadius || city.radius, 40000)

  const query = `[out:json][timeout:5];
(
  node["shop"]["name"~"${escaped}",i](around:${radius},${city.lat},${city.lon});
  node["amenity"~"marketplace|market"]["name"~"${escaped}",i](around:${radius},${city.lat},${city.lon});
);
out tags 15;`

  // Own timeout — abort after 3s regardless
  const ownController = new AbortController()
  const timer = setTimeout(() => ownController.abort(), 3000)
  // Abort if parent aborts too
  const onParentAbort = () => ownController.abort()
  signal.addEventListener('abort', onParentAbort)

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ownController.signal,
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data.remark?.includes('timed out')) return []

    return (data.elements ?? [])
      .map((el: any) => {
        const tags = el.tags ?? {}
        const street = tags['addr:street'] || ''
        const house = tags['addr:housenumber'] || ''
        const addrCity = tags['addr:city'] || city.name

        let address: string
        if (street && house) {
          address = [addrCity, `${street}, ${house}`].filter(Boolean).join(', ')
        } else if (street) {
          address = [addrCity, street].filter(Boolean).join(', ')
        } else {
          address = addrCity
        }

        let storeType: 'market' | 'store' | undefined
        if (tags.amenity === 'marketplace' || tags.amenity === 'market') storeType = 'market'
        else if (tags.shop) storeType = 'store'

        return {
          osmId: `o-${el.id}`,
          name: tags.name || tags.brand || 'Без названия',
          address,
          type: storeType,
          source: 'overpass' as const,
          lat: String(el.lat ?? ''),
          lon: String(el.lon ?? ''),
        } as OsmResult
      })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onParentAbort)
  }
}

// ─── Photon (Komoot) ───
async function searchPhoton(
  apiQuery: string,
  city: City,
  signal: AbortSignal,
): Promise<OsmResult[]> {
  const params = new URLSearchParams({
    q: apiQuery,
    limit: '15',
    lat: String(city.lat),
    lon: String(city.lon),
    location_bias_scale: '0.2',
  })

  const resp = await fetch(`https://photon.komoot.io/api/?${params}`, { signal })
  if (!resp.ok) return []
  const data = await resp.json()

  return (data.features ?? [])
    .filter((f: any) => {
      const p = f.properties ?? {}
      if (p.countrycode !== 'BY') return false
      if (!p.street || !p.housenumber) return false
      return p.osm_key === 'shop' || ['marketplace', 'market'].includes(p.osm_value || '') || p.name
    })
    .map((f: any) => {
      const p = f.properties ?? {}
      const c = p.city || p.town || p.village || ''
      const parts = [c, `${p.street}, ${p.housenumber}`].filter(Boolean)
      const [lon, lat] = f.geometry?.coordinates ?? [0, 0]

      let storeType: 'market' | 'store' | undefined
      const val = p.osm_value || ''
      if (['marketplace', 'market'].includes(val)) storeType = 'market'
      else if (p.osm_key === 'shop') storeType = 'store'

      return {
        osmId: `p-${p.osm_id}`,
        name: p.name || p.street || 'Без названия',
        address: parts.join(', '),
        type: storeType,
        source: 'photon' as const,
        lat: String(lat),
        lon: String(lon),
      } as OsmResult
    })
}

// ─── Geoapify ───
const GEOAPIFY_KEY = import.meta.env.VITE_GEOAPIFY_KEY || ''

async function searchGeoapify(
  apiQuery: string,
  city: City,
  signal: AbortSignal,
): Promise<OsmResult[]> {
  if (!GEOAPIFY_KEY) return []
  // Use circle filter around city center covering the whole oblast
  const regionRadius = city.regionRadius || city.radius
  const radiusKm = Math.round(regionRadius / 1000)
  const params = new URLSearchParams({
    text: apiQuery,
    lang: 'ru',
    limit: '15',
    type: 'amenity',
    filter: `circle:${city.lon},${city.lat},${radiusKm * 1000}`,
    bias: `proximity:${city.lon},${city.lat}`,
    apiKey: GEOAPIFY_KEY,
  })

  const resp = await fetch(
    `https://api.geoapify.com/v1/geocode/autocomplete?${params}`,
    { signal },
  )
  if (!resp.ok) return []
  const data = await resp.json()

  return (data.features ?? [])
    .filter((f: any) => {
      const p = f.properties ?? {}
      return p.street && p.housenumber
    })
    .map((f: any) => {
      const p = f.properties ?? {}
      const c = p.city || p.town || p.village || ''
      const parts = [c, `${p.street}, ${p.housenumber}`].filter(Boolean)

      let storeType: 'market' | 'store' | undefined
      const cats = (p.categories ?? []) as string[]
      if (cats.some((ct: string) => ct.includes('market'))) storeType = 'market'
      else if (cats.some((ct: string) => ct.includes('shop') || ct.includes('commercial'))) storeType = 'store'

      return {
        osmId: `g-${p.place_id || p.osm_id || Math.random()}`,
        name: p.name || p.street || 'Без названия',
        address: parts.join(', '),
        type: storeType,
        source: 'geoapify' as const,
        lat: String(p.lat ?? ''),
        lon: String(p.lon ?? ''),
      } as OsmResult
    })
}

// ─── Main hook: progressive/streaming results ───
export function useOsmSearch(query: string, city: City) {
  const [results, setResults] = useState<OsmResult[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const abortRef = useRef<AbortController>(undefined)
  // Accumulator ref so each callback can merge into latest state
  const accRef = useRef<OsmResult[]>([])
  const pendingRef = useRef(0)

  const mergeResults = useCallback((incoming: OsmResult[], filterWords: string[]) => {
    const filtered = clientFilter(incoming, filterWords)
    accRef.current = dedup([...accRef.current, ...filtered])
    setResults(accRef.current.slice(0, 12))
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()

    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) {
      setResults([])
      setLoading(false)
      accRef.current = []
      pendingRef.current = 0
      return
    }

    setLoading(true)

    timerRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      accRef.current = []
      pendingRef.current = 4

      const words = trimmed.split(/\s+/)
      const firstWord = words[0]
      const filterWords = words.map((w) => w.toLowerCase())

      const onDone = () => {
        pendingRef.current--
        if (pendingRef.current <= 0) {
          setLoading(false)
        }
      }

      // Fire all four, each updates results independently on resolve
      searchPhoton(trimmed, city, controller.signal)
        .then((r) => mergeResults(r, filterWords))
        .catch(() => {})
        .finally(onDone)

      searchGeoapify(trimmed, city, controller.signal)
        .then((r) => mergeResults(r, filterWords))
        .catch(() => {})
        .finally(onDone)

      searchNominatim(firstWord, city, controller.signal)
        .then((r) => mergeResults(r, filterWords))
        .catch(() => {})
        .finally(onDone)

      searchOverpass(firstWord, city, controller.signal)
        .then((r) => mergeResults(r, filterWords))
        .catch(() => {})
        .finally(onDone)
    }, 400)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [query, city, mergeResults])

  return { results, loading }
}
