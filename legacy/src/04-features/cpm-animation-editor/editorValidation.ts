import { SKIN_LAYERS, type CPMAnimation, type CPMAnimationKind, type CPMAnimEnc } from '@/05-entities'
import { shortestAngleDelta } from './editorModel'
import { vanillaPoseName } from './editorTriggers'
import type { EditorAnimationState } from './types'

export const EDITOR_MAX_ANIMATIONS = 250
export const EDITOR_MIN_FREE_LAYERS = 2
export const EDITOR_SERVICE_PREFIXES = ['$layer$', '$value$', '$pre$', '$post$'] as const
export const EDITOR_LINEAR_ANGLE_THRESHOLD = 30
export const EDITOR_LINEAR_POSITION_THRESHOLD = 2
export const EDITOR_LINEAR_WARNING =
  'Линейный интерполятор при заметной разнице между соседними ключами даёт механический переход'

export interface EditorValidationResult {
  errors: string[]
  warnings: string[]
}

export interface AnimationDraft {
  id?: string
  name: string
  kind: CPMAnimationKind
  poseIndex?: number | undefined
}

export interface AnimationValidationContext {
  animations: CPMAnimation[]
  animEnc: CPMAnimEnc | null
  isNew: boolean
}

export function validateAnimationName(name: string): string[] {
  const trimmed = name.trim()
  if (trimmed === '') return ['Имя анимации не может быть пустым']

  const prefix = EDITOR_SERVICE_PREFIXES.find((item) => trimmed.startsWith(item))
  if (prefix !== undefined) {
    return [`Имя анимации не может начинаться со служебного префикса ${prefix}`]
  }
  if (trimmed.includes('$')) return ['Имя анимации не может содержать символ $']
  return []
}

export function validateLayerTrigger(
  kind: CPMAnimationKind,
  animEnc: CPMAnimEnc | null,
): string[] {
  if (kind !== 'layer' && kind !== 'value-layer') return []
  if (animEnc === null) {
    return ['В проекте нет anim_enc.json: анимация сохранится без привязки к слоям скина']
  }

  const freeLayers = SKIN_LAYERS.filter((layer) => animEnc.freeLayers.includes(layer))
  if (freeLayers.length < EDITOR_MIN_FREE_LAYERS) {
    return ['В проекте меньше двух свободных слоёв скина: анимация сохранится без привязки к слоям']
  }
  return []
}

export function validateAnimationDraft(
  draft: AnimationDraft,
  context: AnimationValidationContext,
): EditorValidationResult {
  const errors = validateAnimationName(draft.name)
  const name = draft.name.trim()

  if (draft.kind === 'vanilla-pose' && vanillaPoseName(draft.poseIndex) === null) {
    errors.push('Выберите ванильную позу из справочника')
  }

  const duplicate = context.animations.find((animation) =>
    animation.id !== draft.id
    && animation.kind === draft.kind
    && animation.name.trim() === name,
  )
  if (duplicate) errors.push('Анимация с таким триггером и именем уже существует')

  if (context.isNew && context.animations.length >= EDITOR_MAX_ANIMATIONS) {
    errors.push(`В проекте не может быть больше ${EDITOR_MAX_ANIMATIONS} анимаций`)
  }

  return {
    errors,
    warnings: validateLayerTrigger(draft.kind, context.animEnc),
  }
}

export function hasMechanicalLinearTransition(state: EditorAnimationState): boolean {
  const { interpolator } = state.data
  if (interpolator !== 'linear_loop' && interpolator !== 'linear_single') return false

  for (const track of state.model.bones.values()) {
    const keys = [...track.keys].sort((first, second) => first - second)
    for (let index = 1; index < keys.length; index++) {
      const previous = track.frames[keys[index - 1] ?? 0]
      const current = track.frames[keys[index] ?? 0]
      if (!previous || !current) continue

      if (Math.abs(shortestAngleDelta(previous.rotation.x, current.rotation.x)) > EDITOR_LINEAR_ANGLE_THRESHOLD) return true
      if (Math.abs(shortestAngleDelta(previous.rotation.y, current.rotation.y)) > EDITOR_LINEAR_ANGLE_THRESHOLD) return true
      if (Math.abs(shortestAngleDelta(previous.rotation.z, current.rotation.z)) > EDITOR_LINEAR_ANGLE_THRESHOLD) return true
      if (Math.abs(current.pos.x - previous.pos.x) > EDITOR_LINEAR_POSITION_THRESHOLD) return true
      if (Math.abs(current.pos.y - previous.pos.y) > EDITOR_LINEAR_POSITION_THRESHOLD) return true
      if (Math.abs(current.pos.z - previous.pos.z) > EDITOR_LINEAR_POSITION_THRESHOLD) return true
    }
  }

  return false
}
