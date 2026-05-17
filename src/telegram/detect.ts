import { retrieveLaunchParams } from '@telegram-apps/sdk-react'

/** Returns the raw Mini App initData string if the app is running inside the TG WebView. */
export function getMiniAppInitData(): string | null {
  try {
    const launchParams = retrieveLaunchParams() as Record<string, unknown>
    const raw = launchParams.initDataRaw as string | undefined
    const hasUser = !!(launchParams.initData as { user?: unknown })?.user
    if (raw && hasUser) return raw
  } catch { /* not available */ }

  if (typeof window !== 'undefined') {
    const webApp = (window as { Telegram?: { WebApp?: Record<string, unknown> } }).Telegram?.WebApp
    if (webApp) {
      const raw = webApp.initData as string | undefined
      const hasUser = !!(webApp.initDataUnsafe as { user?: unknown })?.user
      if (raw && hasUser) return raw
    }
  }

  if (typeof window !== 'undefined') {
    const initParams = (window as Window & { __telegram__initParams?: { tgWebAppData?: string } }).__telegram__initParams
    if (initParams?.tgWebAppData) return initParams.tgWebAppData
  }

  return null
}

export function isMiniApp(): boolean {
  return getMiniAppInitData() !== null
}
