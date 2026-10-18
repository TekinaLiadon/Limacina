export interface FrameColorOption {
  value: string
  label: string
}

export const FRAME_COLOR_OPTIONS: FrameColorOption[] = [
  { value: '#ef4444', label: 'Красный' },
  { value: '#f97316', label: 'Оранжевый' },
  { value: '#eab308', label: 'Жёлтый' },
  { value: '#22c55e', label: 'Зелёный' },
  { value: '#06b6d4', label: 'Голубой' },
  { value: '#3b82f6', label: 'Синий' },
  { value: '#a855f7', label: 'Фиолетовый' },
  { value: '#ec4899', label: 'Розовый' },
]

const FRAME_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isFrameColor(value: unknown): value is string {
  return typeof value === 'string' && FRAME_COLOR_PATTERN.test(value)
}

export function frameColorLabel(color: string | null): string | null {
  if (color === null) return null
  return FRAME_COLOR_OPTIONS.find((option) => option.value === color)?.label ?? null
}
