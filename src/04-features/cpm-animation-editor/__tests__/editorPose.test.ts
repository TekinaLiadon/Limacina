import { describe, expect, it } from 'vitest'
import type {
  CPMAnimation,
  CPMAnimationFrame,
  CPMConfig,
  CPMVec3,
} from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState } from '../editorModel'
import { mirrorBonePose, setBonePose, smoothBoneTrack } from '../editorOperations'
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
          rotation: vec(0, 10, 0),
          scale: vec(1, 1, 1),
          storeID: 100,
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

describe('mirrorBonePose', () => {
  it('mirrors the pose across the sides relative to rest', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(3)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(5, 30, 15), vec(1, 4, 2))))

    const mirrored = apply(mirrorBonePose(state, 100, 0))
    const [mirroredFrame] = trackOf(mirrored, 100).frames

    expect(mirroredFrame?.rotation.x).toBeCloseTo(5)
    expect(mirroredFrame?.rotation.y).toBeCloseTo(350)
    expect(mirroredFrame?.rotation.z).toBeCloseTo(345)
    expect(mirroredFrame?.pos).toEqual(vec(-1, 4, 2))
    expect(mirroredFrame?.show).toBe(true)
  })

  it('mirrors back to the original pose', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(3)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(5, 30, 15), vec(1, 4, 2))))
    state = apply(mirrorBonePose(state, 100, 0))

    const restored = apply(mirrorBonePose(state, 100, 0))
    const [frame] = trackOf(restored, 100).frames

    expect(frame?.rotation.x).toBeCloseTo(5)
    expect(frame?.rotation.y).toBeCloseTo(30)
    expect(frame?.rotation.z).toBeCloseTo(15)
    expect(frame?.pos).toEqual(vec(1, 4, 2))
  })

  it('ignores a pose that is already symmetric', () => {
    const state = buildEditorState(makeAnimation(emptyFrames(3)), index)

    expect(mirrorBonePose(state, 100, 1)).toBeNull()
  })
})

describe('smoothBoneTrack', () => {
  it('smooths the inner keys and keeps the endpoints', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(5)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 0, 0))))
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 90, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 0, 0))))

    const smoothed = apply(smoothBoneTrack(state, 100))
    const track = trackOf(smoothed, 100)

    expect(track.keys).toEqual([0, 2, 4])
    expect(track.frames[0]?.rotation.y).toBe(0)
    expect(track.frames[2]?.rotation.y).toBeCloseTo(45)
    expect(track.frames[4]?.rotation.y).toBe(0)
    expect(track.frames[1]?.rotation.y).toBeCloseTo(22.5)
    expect(track.frames[3]?.rotation.y).toBeCloseTo(22.5)
  })

  it('smooths positions', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(5)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 20, 0), vec(0, 4, 0))))
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 20, 0), vec(0, 14, 0))))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 20, 0), vec(0, 4, 0))))

    const smoothed = apply(smoothBoneTrack(state, 100))

    expect(trackOf(smoothed, 100).frames[2]?.pos.y).toBeCloseTo(9)
  })

  it('keeps visibility unchanged', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(5)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 20, 0), vec(0, 4, 0), true)))
    state = apply(setBonePose(state, 100, 2, pose(vec(0, 90, 0), vec(0, 4, 0), false)))
    state = apply(setBonePose(state, 100, 4, pose(vec(0, 20, 0), vec(0, 4, 0), true)))

    const smoothed = apply(smoothBoneTrack(state, 100))

    expect(trackOf(smoothed, 100).frames[2]?.show).toBe(false)
  })

  it('does nothing with fewer than three keys', () => {
    let state = buildEditorState(makeAnimation(emptyFrames(4)), index)
    state = apply(setBonePose(state, 100, 0, pose(vec(0, 20, 0))))
    state = apply(setBonePose(state, 100, 3, pose(vec(0, 40, 0))))

    expect(smoothBoneTrack(state, 100)).toBeNull()
  })
})
