import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CITIES, type City } from '../../config/cities'
import { useAuth } from '../../contexts/AuthContext'

interface HeaderProps {
  city: City
  onCityChange: (city: City) => void
}

export function Header({ city, onCityChange }: HeaderProps) {
  const navigate = useNavigate()
  const { currentRoom, isAuthenticated } = useAuth()
  const [showCities, setShowCities] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowCities(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header className="bg-header-bg backdrop-blur-lg sticky top-0 z-10 border-b border-separator/30">
      <div className="px-4 h-11 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="text-[17px] font-semibold text-text shrink-0 active:opacity-60 transition-opacity"
          >
            Shop Assist
          </button>
          {/* Room name */}
          {isAuthenticated && currentRoom && !currentRoom.is_personal && (
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-primary/10 text-primary-text font-medium truncate max-w-[100px]">
              {currentRoom.name}
            </span>
          )}
          {/* City selector */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowCities(!showCities)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary-text text-[12px] font-medium active:bg-primary/20 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {city.name}
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 4.5l3 3 3-3" />
              </svg>
            </button>
            {showCities && (
              <div className="absolute top-full left-0 mt-1.5 bg-surface rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.15)] z-20 min-w-[140px] overflow-hidden">
                {CITIES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onCityChange(c)
                      setShowCities(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-[13px] transition-colors border-b border-separator/20 last:border-b-0 ${
                      c.id === city.id
                        ? 'text-primary-text font-semibold bg-primary/5'
                        : 'text-text active:bg-bg-secondary'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/stores')}
            className="w-8 h-8 flex items-center justify-center rounded-full text-primary-text active:bg-primary/10 transition-colors"
            title="Stores"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7l4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
              <path d="M2 7h20" />
              <path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
