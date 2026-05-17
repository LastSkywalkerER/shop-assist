import { supabase } from '../lib/supabase/client'
import { isMiniApp } from '../telegram/detect'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSubscriptionStatus = {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  hasSubscription: boolean
  vapidConfigured: boolean
}

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (!('PushManager' in window)) return false
  if (!('Notification' in window)) return false
  if (isMiniApp()) return false
  return true
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
}

export async function getPushStatus(): Promise<PushSubscriptionStatus> {
  if (!isPushSupported()) {
    return { supported: false, permission: 'unsupported', hasSubscription: false, vapidConfigured: !!VAPID_PUBLIC_KEY }
  }
  const reg = await getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  return {
    supported: true,
    permission: Notification.permission,
    hasSubscription: !!sub,
    vapidConfigured: !!VAPID_PUBLIC_KEY,
  }
}

export async function subscribeToPush(userId: string): Promise<void> {
  if (!isPushSupported()) throw new Error('Push not supported in this browser')
  if (!VAPID_PUBLIC_KEY) throw new Error('VAPID_PUBLIC_KEY is not configured')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permission denied')

  const reg = await getRegistration()
  if (!reg) throw new Error('Service worker is not registered yet')

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  const endpoint = json.endpoint ?? sub.endpoint
  const p256dh = json.keys?.p256dh ?? arrayBufferToBase64(sub.getKey('p256dh'))
  const auth = json.keys?.auth ?? arrayBufferToBase64(sub.getKey('auth'))

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
  if (error) throw error
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (!sub) return
  const endpoint = sub.endpoint
  try {
    await sub.unsubscribe()
  } catch (err) {
    console.warn('pushManager.unsubscribe failed:', err)
  }
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}

export async function setNotificationPreference(
  userId: string,
  field: 'notify_via_pwa' | 'notify_via_telegram',
  value: boolean,
): Promise<void> {
  const { error } = await supabase.from('users').update({ [field]: value }).eq('id', userId)
  if (error) throw error
}

/**
 * Triggers a real Web Push delivery to all of the current user's registered
 * subscriptions via the edge function. Returns per-subscription stats so the
 * UI can show "FCM accepted N pushes" vs "all failed".
 */
export async function sendTestPush(userId: string): Promise<{
  total: number
  ok: number
  gone: number
  failed: number
  lastError?: string
}> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { action: 'test_push', user_id: userId },
  })
  if (error) throw error
  return data as { total: number; ok: number; gone: number; failed: number; lastError?: string }
}
