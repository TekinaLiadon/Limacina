import { describe, expect, it } from 'vitest'
import type { CPMAnimation, CPMConfig, CPMVec3 } from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState } from '../editorModel'
import {
  moveEditorFrame,
  resizeEditorModel,
  setBonePose,
  setFrameColor,
} from '../editorOperations'
import type { EditorAnimationState, EditorPose } from '../types'

const vec = (x = 0, y = 0, z = 0): CPMVec3 => ({ x, y, z })

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    { id: 'head', name: 'Head', pos: vec(), rotation: vec() },
    {
      id: 'custom_part',
      name: 'Custom',
      customPart: true,
      storeID: 7,
      pos: vec(),
      rotation: vec(),
    },
  ],
}

const pose = (rotationY: number): EditorPose => ({
  rotation: vec(0, rotationY, 0),
  pos: vec(),
  show: true,
})

const makeAnimation = (frameCount = 4): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop',
  hidden: false,
  frames: Array.from({ length: frameCount }, () => ({ components: [] })),
})

const makeState = (): EditorAnimationState => {
  const initial = buildEditorState(makeAnimation(), buildEditorBoneIndex(config))
  const withHead = setBonePose(initial, 0, 0, pose(10))
  if (withHead === null) throw new Error('Не поставился ключ головы')
  const withHeadTail = setBonePose(withHead, 0, 3, pose(30))
  if (withHeadTail === null) throw new Error('Не поставился второй ключ головы')
  const withCustom = setBonePose(withHeadTail, 7, 2, pose(20))
  if (withCustom === null) throw new Error('Не поставился ключ детали')
  return withCustom
}

const trackOf = (state: EditorAnimationState, storeId: number) => {
  const track = state.model.bones.get(storeId)
  if (track === undefined) throw new Error(`Нет трека ${storeId}`)
  return track
}

describe('moveEditorFrame', () => {
  it('moves the whole frame slot and remaps every bone key', () => {
    const state = makeState()
    const next = moveEditorFrame(state, 3, 0)

    expect(next).not.toBeNull()
    if (next === null) return

    const head = trackOf(next, 0)
    expect(head.keys).toEqual([0, 1])
    expect(head.frames[0]?.rotation.y).toBe(30)
    expect(head.frames[1]?.rotation.y).toBe(10)

    const custom = trackOf(next, 7)
    expect(custom.keys).toEqual([3])
  })

  it('moves frame colors together with the frame slot', () => {
    const withColors = setFrameColor(makeState(), 0, '#ef4444')
    const withSecond = setFrameColor(withColors ?? makeState(), 2, '#3b82f6')
    const withThird = setFrameColor(withSecond ?? makeState(), 3, '#22c55e')
    const next = moveEditorFrame(withThird ?? makeState(), 3, 0)

    expect(next).not.toBeNull()
    if (next === null) return

    expect(next.frameColors.get(0)).toBe('#22c55e')
    expect(next.frameColors.get(1)).toBe('#ef4444')
    expect(next.frameColors.get(3)).toBe('#3b82f6')
    expect(next.frameColors.size).toBe(3)
  })

  it('rejects out-of-range and unchanged moves', () => {
    const state = makeState()

    expect(moveEditorFrame(state, 0, 0)).toBeNull()
    expect(moveEditorFrame(state, -1, 2)).toBeNull()
    expect(moveEditorFrame(state, 2, 4)).toBeNull()
    expect(moveEditorFrame(state, 0, 1.5)).toBeNull()
  })
})

describe('setFrameColor', () => {
  it('adds, replaces and removes a frame color', () => {
    const state = makeState()
    const added = setFrameColor(state, 1, '#ef4444')
    expect(added?.frameColors.get(1)).toBe('#ef4444')

    const replaced = setFrameColor(added ?? state, 1, '#22c55e')
    expect(replaced?.frameColors.get(1)).toBe('#22c55e')

    const removed = setFrameColor(replaced ?? state, 1, null)
    expect(removed?.frameColors.has(1)).toBe(false)
  })

  it('returns null for invalid frames and no-op changes', () => {
    const state = makeState()
    const colored = setFrameColor(state, 1, '#ef4444')

    expect(setFrameColor(state, 4, '#ef4444')).toBeNull()
    expect(setFrameColor(state, -1, '#ef4444')).toBeNull()
    expect(setFrameColor(colored ?? state, 1, '#ef4444')).toBeNull()
    expect(setFrameColor(state, 1, null)).toBeNull()
  })
})

describe('resizeEditorModel frame colors', () => {
  it('drops colors beyond the new frame count and keeps the rest', () => {
    const state = makeState()
    const first = setFrameColor(state, 0, '#ef4444')
    const second = setFrameColor(first ?? state, 2, '#3b82f6')
    const resized = resizeEditorModel(second ?? state, 2)

    expect(resized).not.toBeNull()
    if (resized === null) return

    expect(resized.frameColors.get(0)).toBe('#ef4444')
    expect(resized.frameColors.has(2)).toBe(false)
  })
})
