import { useState, useEffect, useRef } from 'react'
import { blobStoreGet } from '../db/blobStore'

/**
 * Resolves blob-store entries into object URLs for a list of attachment IDs.
 * Returns a map of id → objectUrl. URLs are revoked automatically when IDs
 * change or on unmount.
 */
export function useLocalBlobUrls(ids: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const activeRef = useRef<Record<string, string>>({})
  const key = ids.join(',')

  useEffect(() => {
    let cancelled = false
    const prev = activeRef.current
    const keep: Record<string, string> = {}
    const idsSet = new Set(ids)

    for (const [id, url] of Object.entries(prev)) {
      if (idsSet.has(id)) {
        keep[id] = url
      } else {
        URL.revokeObjectURL(url)
      }
    }

    const toLoad = ids.filter(id => !keep[id])
    if (toLoad.length === 0) {
      activeRef.current = keep
      setUrls(keep)
      return
    }

    Promise.all(
      toLoad.map(async id => {
        const blob = await blobStoreGet(id)
        if (!cancelled && blob) {
          keep[id] = URL.createObjectURL(blob)
        }
      }),
    ).then(() => {
      if (cancelled) return
      activeRef.current = keep
      setUrls({ ...keep })
    })

    return () => { cancelled = true }
  }, [key])

  useEffect(() => () => {
    for (const url of Object.values(activeRef.current)) {
      URL.revokeObjectURL(url)
    }
    activeRef.current = {}
  }, [])

  return urls
}
