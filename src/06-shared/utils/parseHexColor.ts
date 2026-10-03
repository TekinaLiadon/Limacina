export function parseHexColor(color: string | undefined): number | null {
  if (!color) return null
  const value = parseInt(color, 16)
  return Number.isNaN(value) ? null : value
}
