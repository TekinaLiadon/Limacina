import type { CPMAnimationInterpolator, CPMAnimationKind } from '@/05-entities'
import type { DropdownOption } from '@/06-shared'
import { VANILLA_DYNAMIC_DURATION_POSES, VANILLA_POSES } from '../cpm-settings/cpmAnimationParser'
import { EDITOR_KIND_LABELS } from './types'

export const EDITOR_KIND_ORDER: CPMAnimationKind[] = [
  'gesture',
  'custom-pose',
  'vanilla-pose',
  'layer',
  'value-layer',
  'setup',
  'finish',
]

export const EDITOR_KIND_OPTIONS: DropdownOption[] = EDITOR_KIND_ORDER.map((kind) => ({
  title: EDITOR_KIND_LABELS[kind],
  value: kind,
}))

export const EDITOR_INTERPOLATOR_LABELS: Record<CPMAnimationInterpolator, string> = {
  linear_loop: 'Линейный, цикл',
  linear_single: 'Линейный, без цикла',
  poly_loop: 'Полиномиальный, цикл',
  poly_single: 'Полиномиальный, без цикла',
  trig_loop: 'Синусоидальный, цикл',
  trig_single: 'Синусоидальный, без цикла',
  no: 'Без интерполяции',
}

const INTERPOLATOR_ORDER: CPMAnimationInterpolator[] = [
  'linear_loop',
  'linear_single',
  'poly_loop',
  'poly_single',
  'trig_loop',
  'trig_single',
  'no',
]

export const EDITOR_INTERPOLATOR_OPTIONS: DropdownOption[] = INTERPOLATOR_ORDER.map((interpolator) => ({
  title: EDITOR_INTERPOLATOR_LABELS[interpolator],
  value: interpolator,
}))

export const EDITOR_VANILLA_POSE_OPTIONS: DropdownOption[] = VANILLA_POSES
  .slice(1)
  .map((name, index) => ({ title: name, value: String(index + 1) }))

export const EDITOR_VANILLA_DURATION_HINT =
  'Время этой позы задаётся состоянием игры: длительность работает как множитель'

export function vanillaPoseName(index: number | null | undefined): string | null {
  if (index === null || index === undefined) return null
  if (!Number.isInteger(index) || index <= 0) return null
  return VANILLA_POSES[index] ?? null
}

export function vanillaPoseHint(index: number | null | undefined): string | null {
  const name = vanillaPoseName(index)
  if (name === null || !VANILLA_DYNAMIC_DURATION_POSES.has(name)) return null
  return EDITOR_VANILLA_DURATION_HINT
}
