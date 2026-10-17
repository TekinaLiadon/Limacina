const decimalPlaces = (value: number): number => {
  if (!Number.isFinite(value)) return 0

  const text = String(value)
  const exponentIndex = text.indexOf('e-')
  if (exponentIndex !== -1) {
    const exponent = Number(text.slice(exponentIndex + 2))
    return Number.isFinite(exponent) ? exponent : 0
  }

  const dotIndex = text.indexOf('.')
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1
}

export const applyNumberStep = (
  current: number,
  delta: 1 | -1,
  step: number,
  min?: number,
  max?: number,
): number => {
  const base = Number.isFinite(current) ? current : 0
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  const next = base + delta * safeStep
  const lower = min === undefined ? -Infinity : min
  const upper = max === undefined ? Infinity : max
  const clamped = Math.min(upper, Math.max(lower, next))
  const precision = Math.max(decimalPlaces(safeStep), Math.min(decimalPlaces(base), 6))

  return Number(clamped.toFixed(Math.min(precision, 10)))
}

