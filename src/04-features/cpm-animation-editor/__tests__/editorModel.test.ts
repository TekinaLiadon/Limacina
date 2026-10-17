import { describe, expect, it } from 'vitest'
import type {
  CPMAnimation,
  CPMAnimationFrame,
  CPMAnimationFrameComponent,
  CPMConfig,
  CPMVec3,
} from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState, serializeEditorAnimation } from '../editorModel'
import type { EditorAnimationState, EditorBoneTrack } from '../types'

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

const component = (
  storeID: number,
  overrides: Partial<CPMAnimationFrameComponent> = {},
): CPMAnimationFrameComponent => ({
  storeID,
  pos: vec(),
  rotation: vec(),
  scale: vec(1, 1, 1),
  show: true,
  color: '0',
  ...overrides,
})

const frame = (...components: CPMAnimationFrameComponent[]): CPMAnimationFrame => ({ components })

const emptyFrames = (count: number): CPMAnimationFrame[] =>
  Array.from({ length: count }, () => frame())

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

function trackOf(state: EditorAnimationState, storeId: number): EditorBoneTrack {
  const track = state.model.bones.get(storeId)
  if (!track) throw new Error(`Нет дорожки кости ${storeId}`)
  return track
}

describe('buildEditorState', () => {
  it('builds a dense model for touched bones and skips untouched ones', () => {
    const animation = makeAnimation([
      frame(component(0, { rotation: vec(0, 10, 0) })),
      frame(),
      frame(component(100, { rotation: vec(0, 45, 0) }), component(101, { pos: vec(0, 2, 4) })),
      frame(component(999, { rotation: vec(0, 20, 0) })),
    ])

    const state = buildEditorState(animation, buildEditorBoneIndex(makeConfig()))

    expect(state.model.frameCount).toBe(4)
    expect([...state.model.bones.keys()].sort((a, b) => a - b)).toEqual([0, 100])

    const head = trackOf(state, 0)
    expect(head.keys).toEqual([0])
    expect(head.frames).toHaveLength(4)
    expect(head.frames[0]?.rotation.y).toBe(10)
    expect(head.frames[1]?.rotation.y).toBe(0)
    expect(head.frames[0]?.pos).toEqual(vec())

    const hat = trackOf(state, 100)
    expect(hat.keys).toEqual([2])
    expect(hat.frames[0]?.rotation.y).toBe(0)
    expect(hat.frames[0]?.pos).toEqual(vec(0, 4, 0))
    expect(hat.frames[2]?.rotation.y).toBe(45)
  })

  it('keeps animation metadata without frames', () => {
    const animation = makeAnimation(emptyFrames(2), {
      kind: 'setup',
      duration: 750,
      interpolator: 'trig_single',
      priority: 3,
      hidden: true,
    })

    const state = buildEditorState(animation, buildEditorBoneIndex(makeConfig()))

    expect(state.data).toEqual({
      id: 'g_wave.json',
      name: 'Wave',
      kind: 'setup',
      duration: 750,
      priority: 3,
      loop: false,
      additive: false,
      interpolator: 'trig_single',
      hidden: true,
    })
  })

  it('fills missing frames with the additive identity for additive animations', () => {
    const animation = makeAnimation([
      frame(),
      frame(component(100, { pos: vec(1, 0, 0) })),
      frame(),
    ], { additive: true })

    const state = buildEditorState(animation, buildEditorBoneIndex(makeConfig()))
    const hat = trackOf(state, 100)

    expect(hat.frames[0]?.pos).toEqual(vec())
    expect(hat.frames[1]?.pos).toEqual(vec(1, 0, 0))
    expect(hat.frames[2]?.pos).toEqual(vec())
    expect(hat.frames[0]?.show).toBe(true)
  })

  it('drops tracks whose every frame equals rest', () => {
    const animation = makeAnimation([
      frame(component(101, { rotation: vec(0, 0, 0), pos: vec(0, 2, 4) })),
      frame(component(101, { pos: vec(0, 2, 4) })),
    ])

    const state = buildEditorState(animation, buildEditorBoneIndex(makeConfig()))

    expect(state.model.bones.has(101)).toBe(false)
  })
})

describe('serializeEditorAnimation', () => {
  it('writes an explicit component into every frame of a touched bone', () => {
    const animation = makeAnimation([
      frame(component(0, { rotation: vec(0, 10, 0) })),
      frame(),
      frame(component(100, { rotation: vec(0, 45, 0) }), component(101, { pos: vec(0, 2, 4) })),
      frame(),
    ])
    const state = buildEditorState(animation, buildEditorBoneIndex(makeConfig()))

    const serialized = serializeEditorAnimation(state)

    expect(serialized.frames).toHaveLength(4)
    expect(serialized.name).toBe('Wave')
    expect(serialized.duration).toBe(1000)
    serialized.frames.forEach((serializedFrame) => {
      expect(serializedFrame.components.map((item) => item.storeID).sort((a, b) => a - b)).toEqual([0, 100])
    })

    const headFrame = serialized.frames[1]?.components.find((item) => item.storeID === 0)
    expect(headFrame).toEqual(component(0))
    const hatFrame = serialized.frames[1]?.components.find((item) => item.storeID === 100)
    expect(hatFrame).toEqual(component(100, { pos: vec(0, 4, 0) }))
  })

  it('does not write bones the editor never touched', () => {
    const animation = makeAnimation([
      frame(component(0, { rotation: vec(0, 10, 0) })),
      frame(component(101, { pos: vec(0, 2, 4) })),
    ])
    const state = buildEditorState(animation, buildEditorBoneIndex(makeConfig()))

    const serialized = serializeEditorAnimation(state)

    const storeIds = new Set<number>()
    serialized.frames.forEach((serializedFrame) => {
      serializedFrame.components.forEach((item) => storeIds.add(item.storeID))
    })
    expect([...storeIds]).toEqual([0])
  })
})
