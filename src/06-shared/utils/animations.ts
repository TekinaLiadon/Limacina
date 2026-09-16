export function isAnimationsEnabled(): boolean {
  return document.documentElement.dataset.animations !== 'off'
}

export function cssDurationMs(token: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
