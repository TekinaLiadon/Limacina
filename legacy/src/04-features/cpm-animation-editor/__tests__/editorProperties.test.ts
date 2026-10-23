import { describe, expect, it } from 'vitest'
import type { CPMAnimation, CPMConfig, CPMVec3 } from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState, resolveBoneRest } from '../editorModel'
import {
  changeAnimationKind,
  changeAnimationPose,
  insertEditorFrame,
  insertEditorStep,
  normalizeEditorDuration,
  normalizeEditorFrameCount,
  normalizeEditorOrder,
  normalizeEditorPriority,
  removeEditorFrame,
  resizeEditorModel,
  scaleEditorDuration,
  setBonePose,
} from '../editorOperations'
import { frameToTimeMs } from '../editorTimeline'
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

const makeAnimation = (overrides: Partial<CPMAnimation> = {}): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: true,
  additive: false,
  interpolator: 'poly_loop',
  hidden: false,
  frames: Array.from({ length: 6 }, () => ({ components: [] })),
  ...overrides,
})

const makeState = (overrides: Partial<CPMAnimation> = {}): EditorAnimationState => {
  const state = buildEditorState(makeAnimation(overrides), buildEditorBoneIndex(config))
  const first = setBonePose(state, 0, 0, pose(10))
  if (first === null) throw new Error('Не поставился первый ключ')
  const second = setBonePose(first, 0, 4, pose(50))
  if (second === null) throw new Error('Не поставился второй ключ')
  return second
}

describe('changeAnimationKind', () => {
  it('switches a gesture to a vanilla pose with the default pose and without looping', () => {
    const state = makeState()
    const next = changeAnimationKind(state, 'vanilla-pose')

    expect(next?.data.kind).toBe('vanilla-pose')
    expect(next?.data.poseIndex).toBe(1)
    expect(next?.data.name).toBe('standing')
    expect(next?.data.loop).toBe(false)
  })

  it('sets the zero pose index for a custom pose', () => {
    const next = changeAnimationKind(makeState(), 'custom-pose')

    expect(next?.data.kind).toBe('custom-pose')
    expect(next?.data.poseIndex).toBe(0)
    expect(next?.data.name).toBe('Wave')
  })

  it('drops the pose index when leaving the pose triggers', () => {
    const vanilla = changeAnimationKind(makeState(), 'vanilla-pose')
    if (vanilla === null) throw new Error('Триггер не сменился')
    const layer = changeAnimationKind(vanilla, 'layer')

    expect(layer?.data.kind).toBe('layer')
    expect('poseIndex' in (layer?.data ?? {})).toBe(false)
    expect(layer?.data.name).toBe('standing')
  })

  it('keeps the model intact and ignores the same trigger', () => {
    const state = makeState()
    expect(changeAnimationKind(state, 'gesture')).toBeNull()

    const next = changeAnimationKind(state, 'setup')
    expect(next?.model).toBe(state.model)
    expect(next?.data.kind).toBe('setup')
  })
})

describe('changeAnimationPose', () => {
  it('selects a vanilla pose and derives its name', () => {
    const next = changeAnimationPose(makeState(), 3)

    expect(next?.data.kind).toBe('vanilla-pose')
    expect(next?.data.poseIndex).toBe(3)
    expect(next?.data.name).toBe('running')
  })

  it('rejects custom and out of range indexes', () => {
    const state = makeState()

    expect(changeAnimationPose(state, 0)).toBeNull()
    expect(changeAnimationPose(state, -1)).toBeNull()
    expect(changeAnimationPose(state, 999)).toBeNull()
  })

  it('ignores selecting the pose that is already active', () => {
    const next = changeAnimationPose(makeState(), 2)
    if (next === null) throw new Error('Поза не выбралась')
    expect(changeAnimationPose(next, 2)).toBeNull()
  })
})

describe('resizeEditorModel', () => {
  it('extends the tracks with rest frames and keeps the keys', () => {
    const state = makeState()
    const next = resizeEditorModel(state, 9)

    expect(next?.model.frameCount).toBe(9)
    const track = next?.model.bones.get(0)
    expect(track?.keys).toEqual([0, 4])
    const bone = next?.index.bones.get(0)
    if (!bone || !track) throw new Error('Нет дорожки')
    const rest = resolveBoneRest(bone, false)
    expect(track.frames[8]).toEqual({
      rotation: rest.rotation,
      pos: rest.pos,
      show: rest.show,
      scale: { x: 1, y: 1, z: 1 },
      color: '0',
    })
  })

  it('trims the keys behind the new border', () => {
    const next = resizeEditorModel(makeState(), 3)

    expect(next?.model.frameCount).toBe(3)
    expect(next?.model.bones.get(0)?.keys).toEqual([0])
  })

  it('resets the fill after the last remaining key when a key is trimmed', () => {
    const next = resizeEditorModel(makeState(), 3)

    const track = next?.model.bones.get(0)
    expect(track?.frames.map((frame) => frame.rotation.y)).toEqual([10, 0, 0])
  })

  it('clamps the frame count to the format range', () => {
    expect(resizeEditorModel(makeState(), 0)?.model.frameCount).toBe(1)
    expect(resizeEditorModel(makeState(), 1000)?.model.frameCount).toBe(255)
    expect(resizeEditorModel(makeState(), 6)).toBeNull()
  })
})

describe('scaleEditorDuration', () => {
  it('keeps the timeline of the keys when the resolution changes', () => {
    expect(scaleEditorDuration(1000, 6, 7)).toBe(1167)
    expect(scaleEditorDuration(1000, 6, 3)).toBe(500)
    expect(scaleEditorDuration(1000, 6, 6)).toBe(1000)
  })

  it('clamps the duration to the format range', () => {
    expect(scaleEditorDuration(65535, 1, 255)).toBe(65535)
    expect(scaleEditorDuration(1, 255, 1)).toBe(1)
  })
})

describe('insertEditorFrame', () => {
  it('raises the resolution without moving the keys in time', () => {
    const state = makeState()
    const next = insertEditorFrame(state)

    expect(next?.model.frameCount).toBe(7)
    expect(next?.data.duration).toBe(1167)
    expect(next?.model.bones.get(0)?.keys).toEqual([0, 4])

    for (const frame of [0, 4]) {
      const before = frameToTimeMs(frame, state.model.frameCount, state.data.duration)
      const after = frameToTimeMs(frame, 7, next?.data.duration ?? 0)
      expect(Math.abs(after - before)).toBeLessThan(1)
    }
  })

  it('does not insert beyond the format frame limit', () => {
    const state = makeState({ frames: Array.from({ length: 255 }, () => ({ components: [] })) })
    expect(insertEditorFrame(state)).toBeNull()
  })
})

describe('insertEditorStep', () => {
  it('extends the animation by a step without moving the keys in time', () => {
    const state = makeState()
    const next = insertEditorStep(state)

    expect(next?.model.frameCount).toBe(9)
    expect(next?.data.duration).toBe(1500)
    expect(next?.model.bones.get(0)?.keys).toEqual([0, 4])

    for (const frame of [0, 4]) {
      const before = frameToTimeMs(frame, state.model.frameCount, state.data.duration)
      const after = frameToTimeMs(frame, next?.model.frameCount ?? 0, next?.data.duration ?? 0)
      expect(Math.abs(after - before)).toBeLessThan(1)
    }
  })

  it('does not extend beyond the duration limit', () => {
    expect(insertEditorStep(makeState({ duration: 65535 }))).toBeNull()
  })
})

describe('removeEditorFrame', () => {
  it('lowers the resolution and keeps the remaining keys in time', () => {
    const state = makeState()
    const next = removeEditorFrame(state)

    expect(next?.model.frameCount).toBe(5)
    expect(next?.data.duration).toBe(833)
    expect(next?.model.bones.get(0)?.keys).toEqual([0, 4])

    const before = frameToTimeMs(4, 6, 1000)
    const after = frameToTimeMs(4, 5, next?.data.duration ?? 0)
    expect(Math.abs(after - before)).toBeLessThan(1)
  })

  it('never goes below one frame', () => {
    const state = makeState()
    const single = resizeEditorModel(state, 1)
    if (single === null) throw new Error('Не ужалось')
    expect(removeEditorFrame(single)).toBeNull()
  })
})

describe('normalizeEditorDuration', () => {
  it('rounds and clamps the duration to the unsigned short range', () => {
    expect(normalizeEditorDuration(1000)).toBe(1000)
    expect(normalizeEditorDuration(1000.6)).toBe(1001)
    expect(normalizeEditorDuration(0)).toBe(1)
    expect(normalizeEditorDuration(-50)).toBe(1)
    expect(normalizeEditorDuration(70000)).toBe(65535)
    expect(normalizeEditorDuration(Number.NaN)).toBe(1)
  })
})

describe('normalizeEditorFrameCount', () => {
  it('rounds and clamps the frame count to the byte range', () => {
    expect(normalizeEditorFrameCount(20)).toBe(20)
    expect(normalizeEditorFrameCount(20.4)).toBe(20)
    expect(normalizeEditorFrameCount(0)).toBe(1)
    expect(normalizeEditorFrameCount(999)).toBe(255)
  })
})

describe('normalizeEditorPriority and normalizeEditorOrder', () => {
  it('clamps the signed byte properties', () => {
    expect(normalizeEditorPriority(5)).toBe(5)
    expect(normalizeEditorPriority(-200)).toBe(-128)
    expect(normalizeEditorPriority(200)).toBe(127)
    expect(normalizeEditorOrder(-3)).toBe(-3)
    expect(normalizeEditorOrder(500)).toBe(127)
  })
})
