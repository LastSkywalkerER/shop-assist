import { useState, useEffect } from 'react'

const FALLBACK_VH = 800

function readViewportHeight(): number {
  if (typeof window === 'undefined') return FALLBACK_VH
  return window.visualViewport?.height ?? window.innerHeight
}

/**
 * Live viewport height for Virtuoso overscan (one screen ≈ one buffer band).
 */
export function useViewportHeight(): number {
  const [h, setH] = useState(() => readViewportHeight())

  useEffect(() => {
    const update = () => setH(readViewportHeight())
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return Math.max(320, h)
}
