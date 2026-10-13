export const DEFAULT_RGB = 0xffffff

export function parseHexColor(color: string | undefined): number | null {
  if (!color) return null
  const hex = color.startsWith('#') ? color.slice(1) : color
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r = '0', g = '0', b = '0'] = hex
    return parseInt(`${r}${r}${g}${g}${b}${b}`, 16)
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  return parseInt(hex, 16)
}
