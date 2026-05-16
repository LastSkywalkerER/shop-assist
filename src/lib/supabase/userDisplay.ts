import type { User } from './types'

export function getDisplayName(user: User | null | undefined): string {
  if (!user) return 'User'
  if (user.display_name) return user.display_name
  if (user.username) return `@${user.username}`
  if (user.first_name) {
    return user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name
  }
  if (user.email && !user.email.endsWith('@telegram.user')) return user.email
  return 'User'
}

export function getAvatarUrl(user: User | null | undefined): string | null {
  if (!user) return null
  return user.avatar_url || user.photo_url || null
}
