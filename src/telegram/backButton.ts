import { backButton } from '@telegram-apps/sdk-react'

export function showBackButton(onBack: () => void): () => void {
  try {
    if (backButton.show.isAvailable()) {
      backButton.show()
      const off = backButton.onClick(onBack)
      return () => {
        off()
        if (backButton.hide.isAvailable()) {
          backButton.hide()
        }
      }
    }
  } catch {
    // Not in Telegram context
  }
  return () => {}
}
