import { describe, expect, it } from 'vitest'
import type {
  CPMAnimation,
  CPMAnimationFrame,
  CPMConfig,
  CPMVec3,
} from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState } from '../editorModel'
import {
  addBoneKey,
  duplicateBonePose,
  ensureBoundaryKeys,
  eraseBoneKey,
  insertPoseAtFraction,
  moveBoneKey,
  setBonePose,
  shiftKeysProportionally,
  updateAnimationData,
} from '../editorOperations'
import type { EditorAnimationState, EditorBoneTrack, EditorPose } from '../types'

const vec = (x = 0, y = 0, z = 0): CPMVec3 => ({ x, y, z })

const makeConfig = (): CPMConfig => ({
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Head',
      pos: vec(),
      rotation: vec(),
      children: [
        {
          name: 'Hat',
          size: vec(8, 8, 8),
          offset: vec(),
          pos: vec(0, 4, 0),
          rotation: vec(),
          scale: vec(1, 1, 1),
          storeID: 100,
        },
        {
          name: 'Nose',
          size: vec(2, 2, 2),
          offset: vec(),
          pos: vec(0, 2, 4),
          rotation: vec(),
          scale: vec(1, 1, 1),
          storeID: 101,
        },
      ],
    },
  ],
})

const index = buildEditorBoneIndex(makeConfig())

const emptyFrames = (count: number): CPMAnimationFrame[] =>
  Array.from({ length: count }, () => ({ components: [] }))

const makeAnimation = (
  frames: CPMAnimationFrame[],
  overrides: Partial<CPMAnimation> = {},
): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop',
  hidden: false,
  frames,
  ...overrides,
})

const apply = (state: EditorAnimationState | null): EditorAnimationState => {
  if (!state) throw new Error('Операция не применилась')
  return state
}

const pose = (
  rotation: CPMVec3 = vec(),
  pos: CPMVec3 = vec(0, 4, 0),
  show = true,
): EditorPose => ({
  rotation: { ...rotation },
  pos: { ...pos },
  show,
})

function trackOf(state: EditorAnimationState, storeId: number): EditorBoneTrack {
  const track = state.model.bones.get(storeId)
  if (!track) throw new Error(`Нет дорожки кости ${storeId}`)
  return track
}

function keysOf(state: EditorAnimationState, storeId: number): number[] {
  return trackOf(state, storeId).keys
}

function rotationY(state: EditorAnimationState, storeId: number, frameIndex: number): number {
  return trackOf(state, storeId).frames[frameIndex]?.rotation.y ?? Number.NaN
}

describe('setBonePose', () => {
  it('writes the pose into the frame and fills the gap from the previous key', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)

    state = apply(setBonePose(state, 100, 0, pose(vec(0, 20, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 60, 0))))

    expect(keysOf(state, 100)).toEqual([0, 4])
    expect(rotationY(state, 100, 0)).toBe(20)
    expect(rotationY(state, 100, 1)).toBeCloseTo(30)
    expect(rotationY(state, 100, 2)).toBeCloseTo(40)
    expect(rotationY(state, 100, 3)).toBeCloseTo(50)
    expect(rotationY(state, 100, 4)).toBe(60)
    expect(rotationY(state, 100, 5)).toBe(0)
    expect(trackOf(state, 100).frames[1]?.pos).toEqual(vec(0, 4, 0))
  })

  it('changes only the touched bone', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(4)), index)
    state = apply(setBonePose(state, 0, 1, pose(vec(0, 20, 0), vec())))

    expect(state.model.bones.has(100)).toBe(false)
    expect(state.model.bones.has(101)).toBe(false)

    const [, headFrame] = trackOf(state, 0).frames
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 30, 0))))

    expect(state.model.bones.has(100)).toBe(true)
    expect(trackOf(state, 0).frames[1]).toBe(headFrame)
  })

  it('snaps values below the quantization threshold to rest and shows no edit', () => {
    const state = buildEditorState(makeAnimation(emptyFrames(3)), index)

    expect(setBonePose(state, 100, 1, pose(vec(0.005, 0, 0)))).toBeNull()
    expect(state.model.bones.size).toBe(0)

    const edited = apply(setBonePose(state, 100, 1, pose(vec(0.02, 0, 0))))
    expect(trackOf(edited, 100).frames[1]?.rotation.x).toBeCloseTo(0.02)
  })

  it('ignores an unchanged pose', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(4)), index)
    state = apply(setBonePose(state, 100, 1, pose(vec(0, 20, 0))))

    expect(setBonePose(state, 100, 1, pose(vec(0, 20, 0)))).toBeNull()
  })

  it('rejects frames outside the animation', () => {
    const state = buildEditorState(makeAnimation(emptyFrames(4)), index)

    expect(setBonePose(state, 100, -1, pose(vec(0, 20, 0)))).toBeNull()
    expect(setBonePose(state, 100, 4, pose(vec(0, 20, 0)))).toBeNull()
    expect(setBonePose(state, 999, 1, pose(vec(0, 20, 0)))).toBeNull()
  })
})

describe('fill interpolation', () => {
  it('fills gaps with the natural spline for poly interpolation', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(11), { interpolator: 'poly_loop' }), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 5, pose(vec(0, 95, 0))))
    state = apply(setBonePose(state, 100, 10, pose(vec(0, 5, 0))))

    expect(rotationY(state, 100, 2)).toBeCloseTo(56.12, 2)
    expect(rotationY(state, 100, 3)).toBeCloseTo(76.28, 2)
    expect(rotationY(state, 100, 7)).toBeCloseTo(76.28, 2)
    expect(rotationY(state, 100, 8)).toBeCloseTo(56.12, 2)
  })

  it('holds the previous key value for the no interpolator', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(6), { interpolator: 'no' }), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 85, 0))))

    expect(rotationY(state, 100, 1)).toBe(5)
    expect(rotationY(state, 100, 2)).toBe(5)
    expect(rotationY(state, 100, 3)).toBe(5)
    expect(rotationY(state, 100, 4)).toBe(85)
  })
})

describe('addBoneKey', () => {
  it('adds a key with the current dense pose', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 20, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 60, 0))))

    const added = apply(addBoneKey(state, 100, 2))

    expect(keysOf(added, 100)).toEqual([0, 2, 4])
    expect(rotationY(added, 100, 2)).toBeCloseTo(40)
    expect(addBoneKey(added, 100, 2)).toBeNull()
  })

  it('starts a track for a bone that has no keys yet', () => {
    const state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    const added = apply(addBoneKey(state, 100, 2))

    expect(keysOf(added, 100)).toEqual([2])
    expect(added.model.bones.has(100)).toBe(true)
  })
})

describe('eraseBoneKey', () => {
  function threeKeys(): EditorAnimationState {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 10, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 80, 0))))
    return state
  }

  it('removes the key and refills the gap between the neighbors', () => {
    const erased = apply(eraseBoneKey(threeKeys(), 100, 2))

    expect(keysOf(erased, 100)).toEqual([0, 4])
    expect(rotationY(erased, 100, 1)).toBeCloseTo(23.75)
    expect(rotationY(erased, 100, 2)).toBeCloseTo(42.5)
    expect(rotationY(erased, 100, 3)).toBeCloseTo(61.25)
  })

  it('clears the fill after the last key', () => {
    const erased = apply(eraseBoneKey(threeKeys(), 100, 4))

    expect(keysOf(erased, 100)).toEqual([0, 2])
    expect(rotationY(erased, 100, 3)).toBe(0)
    expect(rotationY(erased, 100, 5)).toBe(0)
    expect(rotationY(erased, 100, 0)).toBe(5)
  })

  it('clears the fill before the first key', () => {
    const erased = apply(eraseBoneKey(threeKeys(), 100, 0))

    expect(keysOf(erased, 100)).toEqual([2, 4])
    expect(rotationY(erased, 100, 0)).toBe(0)
    expect(rotationY(erased, 100, 1)).toBe(0)
  })

  it('drops the track when the last key is removed', () => {
    let state = apply(eraseBoneKey(threeKeys(), 100, 2))
    state = apply(eraseBoneKey(state, 100, 4))
    state = apply(eraseBoneKey(state, 100, 0))

    expect(state.model.bones.has(100)).toBe(false)
  })

  it('ignores frames without a key', () => {
    expect(eraseBoneKey(threeKeys(), 100, 1)).toBeNull()
  })
})

describe('insertPoseAtFraction', () => {
  function twoKeys(interpolator: CPMAnimation['interpolator']): EditorAnimationState {
    let state = buildEditorState(makeAnimation(emptyFrames(6), { interpolator }), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 85, 0))))
    return state
  }

  it('inserts a pose at a fraction of the path between two keys', () => {
    const inserted = apply(insertPoseAtFraction(twoKeys('linear_loop'), 100, 0, 4, 0.5))

    expect(keysOf(inserted, 100)).toEqual([0, 2, 4])
    expect(rotationY(inserted, 100, 2)).toBeCloseTo(45)
    expect(rotationY(inserted, 100, 1)).toBeCloseTo(25)
    expect(rotationY(inserted, 100, 3)).toBeCloseTo(65)
  })

  it('samples the trig interpolator at the inserted fraction', () => {
    const inserted = apply(insertPoseAtFraction(twoKeys('trig_loop'), 100, 0, 4, 0.5))

    expect(rotationY(inserted, 100, 2)).toBeCloseTo(5 + Math.sin(Math.PI / 4) * 80, 4)
  })

  it('rejects fractions that round onto an anchor key', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(3)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 1, pose(vec(0, 10, 0))))

    expect(insertPoseAtFraction(state, 100, 0, 1, 0.4)).toBeNull()
    expect(insertPoseAtFraction(state, 100, 0, 1, 0.6)).toBeNull()
    expect(insertPoseAtFraction(state, 100, 0, 1, 2)).toBeNull()
  })

  it('rejects anchors that are not keys', () => {
    expect(insertPoseAtFraction(twoKeys('linear_loop'), 100, 1, 4, 0.5)).toBeNull()
    expect(insertPoseAtFraction(twoKeys('linear_loop'), 100, 0, 3, 0.5)).toBeNull()
  })
})

describe('duplicateBonePose', () => {
  function twoKeys(): EditorAnimationState {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 20, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 60, 0))))
    return state
  }

  it('copies the dense pose of a frame into another frame as a key', () => {
    const duplicated = apply(duplicateBonePose(twoKeys(), 100, 2, 5))

    expect(keysOf(duplicated, 100)).toEqual([0, 4, 5])
    expect(rotationY(duplicated, 100, 2)).toBeCloseTo(40)
    expect(rotationY(duplicated, 100, 5)).toBeCloseTo(40)
    expect(rotationY(duplicated, 100, 3)).toBeCloseTo(50)
  })

  it('copies a key pose onto a later frame', () => {
    const duplicated = apply(duplicateBonePose(twoKeys(), 100, 0, 3))

    expect(keysOf(duplicated, 100)).toEqual([0, 3, 4])
    expect(rotationY(duplicated, 100, 3)).toBe(20)
    expect(rotationY(duplicated, 100, 1)).toBeCloseTo(20)
    expect(rotationY(duplicated, 100, 2)).toBeCloseTo(20)
  })
})

describe('moveBoneKey', () => {
  function threeKeys(): EditorAnimationState {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 10, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 80, 0))))
    return state
  }

  it('moves a single key and refills both neighboring gaps', () => {
    const moved = apply(moveBoneKey(threeKeys(), 100, 2, 3))

    expect(keysOf(moved, 100)).toEqual([0, 3, 4])
    expect(rotationY(moved, 100, 3)).toBe(10)
    expect(rotationY(moved, 100, 1)).toBeCloseTo(5 + 5 / 3)
    expect(rotationY(moved, 100, 2)).toBeCloseTo(5 + 10 / 3)
  })

  it('clears the frames before the new first key', () => {
    const moved = apply(moveBoneKey(threeKeys(), 100, 0, 5))

    expect(keysOf(moved, 100)).toEqual([2, 4, 5])
    expect(rotationY(moved, 100, 0)).toBe(0)
    expect(rotationY(moved, 100, 1)).toBe(0)
    expect(rotationY(moved, 100, 3)).toBeCloseTo(45)
    expect(rotationY(moved, 100, 5)).toBe(5)
  })

  it('rejects invalid moves', () => {
    expect(moveBoneKey(threeKeys(), 100, 4, 6)).toBeNull()
    expect(moveBoneKey(threeKeys(), 100, 1, 3)).toBeNull()
    expect(moveBoneKey(threeKeys(), 100, 2, 2)).toBeNull()
  })
})

describe('shiftKeysProportionally', () => {
  function fourKeys(): EditorAnimationState {
    let state = buildEditorState(makeAnimation(emptyFrames(10)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 25, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 45, 0))))
    state = apply(setBonePose(state, 100, 6, pose(vec(0, 65, 0))))
    return state
  }

  it('shifts the group proportionally between the anchor keys', () => {
    const shifted = apply(shiftKeysProportionally(fourKeys(), 100, 0, 6, -2))

    expect(keysOf(shifted, 100)).toEqual([0, 1, 3, 4])
    expect(rotationY(shifted, 100, 1)).toBe(25)
    expect(rotationY(shifted, 100, 2)).toBeCloseTo(35)
    expect(rotationY(shifted, 100, 3)).toBe(45)
    expect(rotationY(shifted, 100, 4)).toBe(65)
    expect(rotationY(shifted, 100, 5)).toBe(0)
  })

  it('merges intermediate keys when the segment collapses', () => {
    const shifted = apply(shiftKeysProportionally(fourKeys(), 100, 0, 6, -5))

    expect(keysOf(shifted, 100)).toEqual([0, 1])
    expect(rotationY(shifted, 100, 1)).toBe(65)
  })

  it('rejects invalid shifts', () => {
    expect(shiftKeysProportionally(fourKeys(), 100, 0, 6, 0)).toBeNull()
    expect(shiftKeysProportionally(fourKeys(), 100, 0, 6, -6)).toBeNull()
    expect(shiftKeysProportionally(fourKeys(), 100, 0, 6, 4)).toBeNull()
    expect(shiftKeysProportionally(fourKeys(), 100, 0, 5, -1)).toBeNull()
  })
})

describe('updateAnimationData', () => {
  it('refills the track when the interpolator changes', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 5, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 85, 0))))
    expect(rotationY(state, 100, 2)).toBeCloseTo(45)

    const updated = apply(updateAnimationData(state, { interpolator: 'trig_loop' }))

    expect(updated.data.interpolator).toBe('trig_loop')
    expect(rotationY(updated, 100, 2)).toBeCloseTo(5 + Math.sin(Math.PI / 4) * 80, 3)
    expect(updateAnimationData(state, { interpolator: 'linear_loop' })).toBeNull()
  })
})

describe('hold last pose', () => {
  const holdState = (count: number, overrides: Partial<CPMAnimation> = {}): EditorAnimationState =>
    buildEditorState(makeAnimation(emptyFrames(count), overrides), index, new Map(), true)

  it('copies the last key pose into the frames after it', () => {
    let state = holdState(6)
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 30, 0))))

    expect(keysOf(state, 100)).toEqual([2])
    expect(rotationY(state, 100, 0)).toBe(0)
    expect(rotationY(state, 100, 1)).toBe(0)
    expect(rotationY(state, 100, 2)).toBe(30)
    expect(rotationY(state, 100, 3)).toBe(30)
    expect(rotationY(state, 100, 4)).toBe(30)
    expect(rotationY(state, 100, 5)).toBe(30)
  })

  it('holds the newest last key after the previous one is erased', () => {
    let state = holdState(6)
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 30, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 90, 0))))

    const erased = apply(eraseBoneKey(state, 100, 4))

    expect(keysOf(erased, 100)).toEqual([2])
    expect(rotationY(erased, 100, 3)).toBe(30)
    expect(rotationY(erased, 100, 5)).toBe(30)
  })

  it('holds the tail after the interpolator is changed', () => {
    let state = holdState(6)
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 30, 0))))

    const updated = apply(updateAnimationData(state, { interpolator: 'no' }))

    expect(rotationY(updated, 100, 5)).toBe(30)
  })

  it('does not key the next step boundary when holding the pose', () => {
    const state = holdState(6)

    const prepared = apply(ensureBoundaryKeys(state, 100, 2, [0, 2, 4]))

    expect(keysOf(prepared, 100)).toEqual([0])
  })

  it('keys the next step boundary without holding the pose', () => {
    const state = buildEditorState(makeAnimation(emptyFrames(6)), index)

    const prepared = apply(ensureBoundaryKeys(state, 100, 2, [0, 2, 4]))

    expect(keysOf(prepared, 100)).toEqual([0, 4])
  })

  it('resets the tail to rest when holding is off', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(6)), index)
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 30, 0))))

    expect(rotationY(state, 100, 5)).toBe(0)
  })
})
