import type { ModelFormat, UserContentItem } from './types'

export function modelFormatOf(item: UserContentItem): ModelFormat {
  return item.format ?? 'cpm'
}

export function filterByFormat(items: UserContentItem[], format: ModelFormat): UserContentItem[] {
  return items.filter((item) => modelFormatOf(item) === format)
}
