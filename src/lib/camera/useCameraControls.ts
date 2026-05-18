import { useCallback, useEffect, useRef, useState } from 'react'

interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean
  focusMode?: string[]
  pointsOfInterest?: boolean
}

type ExtendedConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean
  focusMode?: string
  pointsOfInterest?: { x: number; y: number }[]
}

interface PhotoCapabilitiesLike {
  fillLightMode?: string[]
}

interface ImageCaptureLike {
  getPhotoCapabilities(): Promise<PhotoCapabilitiesLike>
}

interface ImageCaptureCtor {
  new (track: MediaStreamTrack): ImageCaptureLike
}

export interface FocusRingState {
  x: number
  y: number
  id: number
}

export interface CameraControls {
  torchSupported: boolean
  torchOn: boolean
  toggleTorch: () => Promise<void>
  focusAt: (clientX: number, clientY: number) => Promise<FocusRingState | null>
  tapFocusSupported: boolean
}

/**
 * Hardens MediaStreamTrack camera controls on Android (Samsung One UI quirks):
 * forces continuous autofocus when available, exposes tap-to-focus via
 * pointsOfInterest, and re-detects torch capability after loadedmetadata and
 * via ImageCapture as a fallback for browsers that don't surface it in
 * MediaTrackCapabilities right away.
 */
export function useCameraControls(
  track: MediaStreamTrack | null,
  videoEl: HTMLVideoElement | null,
): CameraControls {
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [tapFocusSupported, setTapFocusSupported] = useState(false)
  const refocusTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!track) {
      setTorchSupported(false)
      setTorchOn(false)
      setTapFocusSupported(false)
      return
    }

    let cancelled = false

    const detect = async () => {
      const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities
      const focusModes = caps.focusMode ?? []
      const supportsContinuous = focusModes.includes('continuous')
      const supportsSingleShot = focusModes.includes('single-shot')
      const supportsPoI = caps.pointsOfInterest === true
      let torch = !!caps.torch

      if (supportsContinuous) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as ExtendedConstraintSet],
          })
        } catch {
          // OverconstrainedError on some drivers is harmless — leave default AF mode.
        }
      }

      if (!torch) {
        try {
          const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture
          if (Ctor) {
            const photoCaps = await new Ctor(track).getPhotoCapabilities()
            const fillLight = photoCaps.fillLightMode ?? []
            if (fillLight.some((m) => m === 'flash' || m === 'auto')) {
              torch = true
            }
          }
        } catch {
          // ImageCapture absent or rejected — keep torch flag as is.
        }
      }

      if (cancelled) return
      setTorchSupported(torch)
      setTapFocusSupported(supportsPoI && supportsSingleShot)
    }

    detect()

    // Samsung Chrome often populates torch/focus capabilities only after the
    // first frame is available, so re-detect on loadedmetadata.
    const onMetadata = () => {
      detect()
    }
    videoEl?.addEventListener('loadedmetadata', onMetadata)

    return () => {
      cancelled = true
      videoEl?.removeEventListener('loadedmetadata', onMetadata)
    }
  }, [track, videoEl])

  useEffect(() => {
    return () => {
      if (refocusTimeoutRef.current !== null) {
        clearTimeout(refocusTimeoutRef.current)
        refocusTimeoutRef.current = null
      }
    }
  }, [track])

  const toggleTorch = useCallback(async () => {
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as ExtendedConstraintSet],
      })
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
      setTorchOn(false)
    }
  }, [track, torchOn])

  const focusAt = useCallback(
    async (clientX: number, clientY: number): Promise<FocusRingState | null> => {
      if (!track || !videoEl || !tapFocusSupported) return null

      const rect = videoEl.getBoundingClientRect()
      const cssX = clientX - rect.left
      const cssY = clientY - rect.top
      if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) {
        return null
      }

      // Compensate for object-cover: the visible portion of the video frame is
      // a centered crop of the full sensor frame. Map the tap from element
      // space to normalized frame space.
      const videoW = videoEl.videoWidth
      const videoH = videoEl.videoHeight
      let nx = cssX / rect.width
      let ny = cssY / rect.height
      if (videoW > 0 && videoH > 0 && rect.width > 0 && rect.height > 0) {
        const elementRatio = rect.width / rect.height
        const videoRatio = videoW / videoH
        if (videoRatio > elementRatio) {
          const visible = elementRatio / videoRatio
          nx = (1 - visible) / 2 + nx * visible
        } else if (videoRatio < elementRatio) {
          const visible = videoRatio / elementRatio
          ny = (1 - visible) / 2 + ny * visible
        }
      }
      nx = Math.max(0, Math.min(1, nx))
      ny = Math.max(0, Math.min(1, ny))

      try {
        await track.applyConstraints({
          advanced: [
            {
              pointsOfInterest: [{ x: nx, y: ny }],
              focusMode: 'single-shot',
            } as ExtendedConstraintSet,
          ],
        })
      } catch {
        return null
      }

      if (refocusTimeoutRef.current !== null) {
        clearTimeout(refocusTimeoutRef.current)
      }
      refocusTimeoutRef.current = window.setTimeout(() => {
        refocusTimeoutRef.current = null
        const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities
        if (caps.focusMode?.includes('continuous')) {
          track
            .applyConstraints({
              advanced: [{ focusMode: 'continuous' } as ExtendedConstraintSet],
            })
            .catch(() => {})
        }
      }, 1500)

      return { x: cssX, y: cssY, id: Date.now() }
    },
    [track, videoEl, tapFocusSupported],
  )

  return { torchSupported, torchOn, toggleTorch, focusAt, tapFocusSupported }
}
