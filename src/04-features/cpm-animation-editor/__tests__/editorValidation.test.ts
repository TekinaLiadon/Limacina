import { describe, expect, it } from 'vitest'
import type { CPMAnimation, CPMAnimEnc, CPMConfig, CPMVec3 } from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState } from '../editorModel'
import {
  EDITOR_MAX_ANIMATIONS,
  hasMechanicalLinearTransition,
  validateAnimationDraft,
  validateAnimationName,
  validateLayerTrigger,
} from '../editorValidation'
import { setBonePose } from '../editorOperations'
import type { EditorPose } from '../types'

const animation = (overrides: Partial<CPMAnimation> = {}): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'poly_loop',
  hidden: false,
  frames: [],
  ...overrides,
})

describe('validateAnimationName', () => {
  it('rejects empty names', () => {
    expect(validateAnimationName('')).not.toEqual([])
    expect(validateAnimationName('   ')).not.toEqual([])
  })

  it('rejects the dollar sign and service prefixes', () => {
    expect(validateAnimationName('$layer$Hat').join(' ')).toContain('$layer$')
    expect(validateAnimationName('$value$Power').join(' ')).toContain('$value$')
    expect(validateAnimationName('$pre$Intro').join(' ')).toContain('$pre$')
    expect(validateAnimationName('$post$Outro').join(' ')).toContain('$post$')
    expect(validateAnimationName('My$Name').join(' ')).toContain('символ $')
  })

  it('accepts a regular name', () => {
    expect(validateAnimationName('Wave')).toEqual([])
    expect(validateAnimationName('  Wave  ')).toEqual([])
  })
})

describe('validateAnimationDraft', () => {
  it('reports a duplicate of the same trigger and name', () => {
    const result = validateAnimationDraft(
      { name: 'Wave', kind: 'gesture' },
      { animations: [animation()], animEnc: null, isNew: true },
    )

    expect(result.errors.join(' ')).toContain('триггером и именем')
  })

  it('allows the same name for a different trigger', () => {
    const result = validateAnimationDraft(
      { name: 'Wave', kind: 'setup' },
      { animations: [animation()], animEnc: null, isNew: true },
    )

    expect(result.errors).toEqual([])
  })

  it('ignores the animation being edited', () => {
    const result = validateAnimationDraft(
      { id: 'g_wave.json', name: 'Wave', kind: 'gesture' },
      { animations: [animation()], animEnc: null, isNew: false },
    )

    expect(result.errors).toEqual([])
  })

  it('enforces the project animation limit', () => {
    const animations = Array.from({ length: EDITOR_MAX_ANIMATIONS }, (_, item) => animation({
      id: `g_${item}.json`,
      name: `Wave ${item}`,
    }))

    const rejected = validateAnimationDraft(
      { name: 'New', kind: 'gesture' },
      { animations, animEnc: null, isNew: true },
    )
    expect(rejected.errors.join(' ')).toContain(String(EDITOR_MAX_ANIMATIONS))

    const allowed = validateAnimationDraft(
      { name: 'New', kind: 'gesture' },
      { animations: animations.slice(1), animEnc: null, isNew: true },
    )
    expect(allowed.errors).toEqual([])

    const edited = validateAnimationDraft(
      { id: 'g_0.json', name: 'Wave 0', kind: 'gesture' },
      { animations, animEnc: null, isNew: false },
    )
    expect(edited.errors).toEqual([])
  })

  it('warns when a layer trigger has no anim_enc.json', () => {
    const result = validateAnimationDraft(
      { name: 'Hat', kind: 'layer' },
      { animations: [], animEnc: null, isNew: true },
    )

    expect(result.errors).toEqual([])
    expect(result.warnings.join(' ')).toContain('anim_enc.json')
  })

  it('warns when there are not enough free skin layers', () => {
    const animEnc: CPMAnimEnc = { freeLayers: ['hat'], defaultValues: {} }

    expect(validateLayerTrigger('layer', animEnc).join(' ')).toContain('свободных слоёв')
    expect(validateLayerTrigger('gesture', animEnc)).toEqual([])

    const enough: CPMAnimEnc = { freeLayers: ['hat', 'jacket'], defaultValues: {} }
    expect(validateLayerTrigger('value-layer', enough)).toEqual([])
  })

  it('requires a vanilla pose index for the vanilla pose trigger', () => {
    const missing = validateAnimationDraft(
      { name: 'standing', kind: 'vanilla-pose' },
      { animations: [], animEnc: null, isNew: false },
    )
    expect(missing.errors.join(' ')).toContain('ванильную позу')

    const zero = validateAnimationDraft(
      { name: 'custom', kind: 'vanilla-pose', poseIndex: 0 },
      { animations: [], animEnc: null, isNew: false },
    )
    expect(zero.errors.join(' ')).toContain('ванильную позу')

    const valid = validateAnimationDraft(
      { name: 'standing', kind: 'vanilla-pose', poseIndex: 1 },
      { animations: [], animEnc: null, isNew: false },
    )
    expect(valid.errors).toEqual([])
  })
})

const vec = (x = 0, y = 0, z = 0): CPMVec3 => ({ x, y, z })

const linearConfig: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [{ id: 'head', name: 'Head', pos: vec(), rotation: vec() }],
}

const pose = (rotationY: number): EditorPose => ({
  rotation: vec(0, rotationY, 0),
  pos: vec(),
  show: true,
})

const linearAnimation = (interpolator: CPMAnimation['interpolator']): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator,
  hidden: false,
  frames: Array.from({ length: 6 }, () => ({ components: [] })),
})

const stateWithJump = (interpolator: CPMAnimation['interpolator']) => {
  const state = buildEditorState(linearAnimation(interpolator), buildEditorBoneIndex(linearConfig))
  const first = setBonePose(state, 0, 0, pose(10))
  if (first === null) throw new Error('Не поставился первый ключ')
  const second = setBonePose(first, 0, 4, pose(100))
  if (second === null) throw new Error('Не поставился второй ключ')
  return second
}

describe('hasMechanicalLinearTransition', () => {
  it('reports a noticeable jump between adjacent keys for linear interpolators', () => {
    expect(hasMechanicalLinearTransition(stateWithJump('linear_loop'))).toBe(true)
    expect(hasMechanicalLinearTransition(stateWithJump('linear_single'))).toBe(true)
  })

  it('stays silent for smooth interpolators and small deltas', () => {
    expect(hasMechanicalLinearTransition(stateWithJump('poly_loop'))).toBe(false)
    expect(hasMechanicalLinearTransition(stateWithJump('trig_loop'))).toBe(false)

    const smooth = buildEditorState(linearAnimation('linear_loop'), buildEditorBoneIndex(linearConfig))
    const first = setBonePose(smooth, 0, 0, pose(10))
    if (first === null) throw new Error('Не поставился первый ключ')
    const second = setBonePose(first, 0, 4, pose(20))
    if (second === null) throw new Error('Не поставился второй ключ')
    expect(hasMechanicalLinearTransition(second)).toBe(false)
  })
})
