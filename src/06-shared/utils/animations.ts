export function isAnimationsEnabled(): boolean {
  return document.documentElement.dataset.animations !== 'off'
}

export function cssDurationMs(token: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  if (raw.endsWith('ms')) return parsed
  if (raw.endsWith('s')) return parsed * 1000
  return parsed
}
