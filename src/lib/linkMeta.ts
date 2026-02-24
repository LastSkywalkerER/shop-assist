export interface LinkMeta {
  url: string
  title?: string
  description?: string
  image?: string
  favicon?: string
}

export function parseLinkMeta(link: string | undefined): LinkMeta | null {
  if (!link) return null
  try {
    return JSON.parse(link) as LinkMeta
  } catch {
    return null
  }
}

export function serializeLinkMeta(meta: LinkMeta): string {
  return JSON.stringify(meta)
}
