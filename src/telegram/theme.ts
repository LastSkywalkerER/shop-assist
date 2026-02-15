const lightTheme: Record<string, string> = {
  '--tg-theme-bg-color': '#ffffff',
  '--tg-theme-text-color': '#1c1c1e',
  '--tg-theme-hint-color': '#8e8e93',
  '--tg-theme-link-color': '#007aff',
  '--tg-theme-button-color': '#007aff',
  '--tg-theme-button-text-color': '#ffffff',
  '--tg-theme-secondary-bg-color': '#f2f2f7',
  '--tg-theme-header-bg-color': '#f8f8fa',
  '--tg-theme-accent-text-color': '#007aff',
  '--tg-theme-section-bg-color': '#ffffff',
  '--tg-theme-section-header-text-color': '#6d6d72',
  '--tg-theme-subtitle-text-color': '#8e8e93',
  '--tg-theme-destructive-text-color': '#ff3b30',
  '--tg-theme-section-separator-color': '#c6c6c8',
}

const darkTheme: Record<string, string> = {
  '--tg-theme-bg-color': '#1c1c1e',
  '--tg-theme-text-color': '#f2f2f7',
  '--tg-theme-hint-color': '#8e8e93',
  '--tg-theme-link-color': '#0a84ff',
  '--tg-theme-button-color': '#0a84ff',
  '--tg-theme-button-text-color': '#ffffff',
  '--tg-theme-secondary-bg-color': '#000000',
  '--tg-theme-header-bg-color': '#1c1c1e',
  '--tg-theme-accent-text-color': '#0a84ff',
  '--tg-theme-section-bg-color': '#2c2c2e',
  '--tg-theme-section-header-text-color': '#8e8e93',
  '--tg-theme-subtitle-text-color': '#8e8e93',
  '--tg-theme-destructive-text-color': '#ff453a',
  '--tg-theme-section-separator-color': '#38383a',
}

export function applyFallbackTheme() {
  const apply = (isDark: boolean) => {
    const theme = isDark ? darkTheme : lightTheme
    const root = document.documentElement
    for (const [key, value] of Object.entries(theme)) {
      root.style.setProperty(key, value)
    }
  }

  apply(window.matchMedia('(prefers-color-scheme: dark)').matches)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => apply(e.matches))
}
