import { isFrameColor } from './frameColors'

const STORAGE_PREFIX = 'limacina-cpm-frame-colors'
const FALLBACK_MODEL_KEY = 'model'

export function frameColorStorageKey(modelKey: string, animationId: string): string {
  const model = modelKey.trim() || FALLBACK_MODEL_KEY
  return `${STORAGE_PREFIX}:${encodeURIComponent(model)}:${encodeURIComponent(animationId)}`
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readFrameColors(key: string): Map<number, string> {
  const colors = new Map<number, string>()
  const store = storage()
  if (store === null) return colors

  let raw: string | null
  try {
    raw = store.getItem(key)
  } catch {
    return colors
  }
  if (raw === null) return colors

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return colors
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return colors

  for (const [frameKey, value] of Object.entries(parsed)) {
    const frame = Number(frameKey)
    if (!Number.isInteger(frame) || frame < 0) continue
    if (!isFrameColor(value)) continue
    colors.set(frame, value)
  }
  return colors
}

export function writeFrameColors(key: string, colors: ReadonlyMap<number, string>): void {
  const store = storage()
  if (store === null) return

  const record: Record<string, string> = {}
  for (const [frame, color] of colors) {
    if (!Number.isInteger(frame) || frame < 0) continue
    if (!isFrameColor(color)) continue
    record[String(frame)] = color
  }

  try {
    if (Object.keys(record).length === 0) store.removeItem(key)
    else store.setItem(key, JSON.stringify(record))
  } catch {
    return
  }
}

export function removeFrameColors(key: string): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(key)
  } catch {
    return
  }
}
