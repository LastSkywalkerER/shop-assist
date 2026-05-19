/**
 * Samsung One UI Chrome (and a few other Android builds) often resolves
 * facingMode: 'environment' to a "logical" multi-camera that does not expose
 * torch or fine-grained focus controls. The actual physical back sensor with
 * those capabilities sits behind a different deviceId.
 *
 * After the initial stream is open we still have the permission grant, so
 * enumerateDevices() returns real labels — iterate back-facing video inputs
 * other than the current one, open each, and return the first whose track
 * exposes torch in MediaTrackCapabilities. Returns null when no better
 * candidate is found; the caller keeps the original stream.
 */

const BACK_LABEL_RE = /back|rear|environment|задн|обратн/i
const FRONT_LABEL_RE = /front|user|selfie|лиц/i

interface CapsWithTorch extends MediaTrackCapabilities {
  torch?: boolean
}

export async function findBetterBackCamera(
  currentTrack: MediaStreamTrack,
  videoExtras: MediaTrackConstraints = {},
): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null

  let devices: MediaDeviceInfo[] = []
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return null
  }

  const currentId = currentTrack.getSettings().deviceId
  const candidates = devices.filter((d) => {
    if (d.kind !== 'videoinput') return false
    if (!d.deviceId || d.deviceId === currentId) return false
    if (!d.label) return true // iOS without labels — try anyway
    if (FRONT_LABEL_RE.test(d.label)) return false
    return BACK_LABEL_RE.test(d.label)
  })

  console.debug('[camera] enumerateDevices', {
    currentId,
    currentLabel: devices.find((d) => d.deviceId === currentId)?.label,
    candidates: candidates.map((d) => ({ id: d.deviceId, label: d.label })),
  })

  for (const cam of candidates) {
    let testStream: MediaStream | null = null
    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: cam.deviceId },
          ...videoExtras,
        },
        audio: false,
      })
      const track = testStream.getVideoTracks()[0]
      const caps = (track?.getCapabilities?.() ?? {}) as CapsWithTorch
      console.debug('[camera] probed', { label: cam.label, torch: !!caps.torch, caps })
      if (caps.torch) {
        return testStream
      }
    } catch (err) {
      console.debug('[camera] probe failed', { label: cam.label, err })
    }
    testStream?.getTracks().forEach((t) => t.stop())
  }
  return null
}
