import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ref, type Ref } from 'vue'
import * as THREE from 'three'
import type { CPMAnimation, CPMAnimationInterpolator } from '@/05-entities'
import {
  CpmAnimationPlayer,
  animationStep,
  createChannelSampler,
  createStepSampler,
  indexModelNodes,
  type ActiveCpmAnimation,
  type NodeIndex,
  type SharedClock,
} from '../cpmAnimationPlayer'

const seq = (...animations: CPMAnimation[]): ActiveCpmAnimation[] =>
  animations.map((animation) => ({ animation, startDelayMs: 0 }))

const makeAnimation = (overrides: Partial<CPMAnimation> = {}): CPMAnimation => ({
  id: 'wave',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_single',
  hidden: false,
  frames: [
    {
      components: [{
        storeID: 0,
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    },
    {
      components: [{
        storeID: 0,
        pos: { x: 0, y: 8, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    },
  ],
  ...overrides,
})

interface PlayerHarness {
  player: CpmAnimationPlayer
  clocks: Map<string, SharedClock>
  isPlaying: Ref<boolean>
  onFinished: Mock
}

const makePlayer = (isPlayingInitially = false): PlayerHarness => {
  const clocks = new Map<string, SharedClock>()
  const onFinished = vi.fn()
  const isPlaying = ref(isPlayingInitially)
  const index: NodeIndex = new Map()
  const player = new CpmAnimationPlayer(index, {
    activeLayerIds: ref<number[]>([]),
    isPlaying,
    onFinished,
  }, clocks)
  return { player, clocks, isPlaying, onFinished }
}

interface ModelPlayerHarness extends PlayerHarness {
  mesh: THREE.Mesh
}

const makePlayerWithModel = (activeLayerIds: Ref<number[]>, isPlayingInitially = false): ModelPlayerHarness => {
  const group = new THREE.Group()
  group.userData.storeID = 0
  group.userData.isRoot = true
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.userData.layerId = 7
  group.add(mesh)

  const clocks = new Map<string, SharedClock>()
  const onFinished = vi.fn()
  const isPlaying = ref(isPlayingInitially)
  const player = new CpmAnimationPlayer(indexModelNodes(group), {
    activeLayerIds,
    isPlaying,
    onFinished,
  }, clocks)
  return { player, clocks, isPlaying, onFinished, mesh }
}

let now = 0

const advance = (ms: number): void => {
  now += ms
}

const INTERPOLATOR_STEPS = [0, 0.25, 0.5, 1.5, 2.75, 3.5, 3.99]
const INTERPOLATOR_VALUES = [0, 10, 4, 7]
const ALL_INTERPOLATORS: CPMAnimationInterpolator[] = [
  'linear_loop',
  'linear_single',
  'trig_loop',
  'trig_single',
  'poly_loop',
  'poly_single',
  'no',
]

describe('game interpolation', () => {
  it('computes the animation step from the frame count and wraps by the duration', () => {
    expect(animationStep(0, 1000, 4)).toBe(0)
    expect(animationStep(250, 1000, 4)).toBeCloseTo(1, 12)
    expect(animationStep(500, 1000, 4)).toBeCloseTo(2, 12)
    expect(animationStep(999, 1000, 4)).toBeCloseTo(3.996, 12)
    expect(animationStep(1500, 1000, 4)).toBeCloseTo(2, 12)
    expect(animationStep(2500, 1000, 4)).toBeCloseTo(2, 12)
  })

  it.each([
    ['linear_loop', [0, 2.5, 5, 7, 6.25, 3.5, 0.07]],
    ['linear_single', [0, 1.875, 3.75, 9.25, 4.1875, 5.875, 6.9775]],
    ['trig_loop', [0, 3.826834323650898, 7.071067811865475, 5.757359312880715, 6.77163859753386, 2.050252531694168, 0.000863572628375664]],
    ['trig_single', [0, 2.902846772544623, 5.555702330196022, 8.82945806790323, 4.294051420988682, 6.494408836907636, 6.999791815440032]],
    ['no', [0, 0, 0, 10, 4, 7, 7]],
    ['poly_loop', [0, 1.8419378221649483, 5.0125644329896915, 7.634987113402062, 6.823735502577319, 2.9500644329896915, -0.013577688144328803]],
    ['poly_single', [0, 2.602497009569378, 5.766148325358851, 7.690789473684211, 5.853917464114834, 7.676435406698565, 7.018036473684209]],
  ] as Array<[CPMAnimationInterpolator, number[]]>)('%s matches the game value vectors', (interpolator, expected) => {
    const sampler = createChannelSampler(INTERPOLATOR_VALUES, interpolator)
    INTERPOLATOR_STEPS.forEach((step, index) => {
      expect(sampler(step)).toBeCloseTo(expected[index]!, 10)
    })
  })

  it('matches the neighboring keys on integer steps for both spline families', () => {
    INTERPOLATOR_VALUES.forEach((value, index) => {
      expect(createChannelSampler(INTERPOLATOR_VALUES, 'poly_loop')(index)).toBeCloseTo(value, 12)
      expect(createChannelSampler(INTERPOLATOR_VALUES, 'poly_single')(index)).toBeCloseTo(value, 12)
    })
  })

  it('wraps loop interpolators and holds the last key for single interpolators at the frame count', () => {
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'linear_loop')(4)).toBe(0)
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'trig_loop')(4)).toBeCloseTo(0, 12)
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'poly_loop')(4)).toBeCloseTo(0, 12)
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'linear_single')(4)).toBe(7)
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'trig_single')(4)).toBeCloseTo(7, 12)
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'poly_single')(4)).toBeCloseTo(7, 12)
    expect(createChannelSampler(INTERPOLATOR_VALUES, 'no')(4)).toBe(0)
  })

  it('holds a single key for every interpolator', () => {
    ALL_INTERPOLATORS.forEach((interpolator) => {
      expect(createChannelSampler([5], interpolator)(0.5)).toBe(5)
      expect(createChannelSampler([5], interpolator)(3)).toBe(5)
    })
    expect(createChannelSampler([], 'poly_loop')(2)).toBe(0)
  })

  it('samples visibility at the wrapped frame index without interpolation', () => {
    const sampler = createStepSampler([1, 0, 1])
    expect(sampler(0.99)).toBe(1)
    expect(sampler(1.99)).toBe(0)
    expect(sampler(2.99)).toBe(1)
    expect(sampler(3)).toBe(1)
  })
})

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CpmAnimationPlayer', () => {
  it('creates a paused clock at zero when animations are added on pause', () => {
    const { player, clocks, onFinished } = makePlayer(false)

    player.setAnimations(seq(makeAnimation()))
    advance(5000)

    const clock = clocks.get('wave')
    expect(clock?.playing).toBe(false)
    expect(clock?.pausedAt).toBe(0)

    player.setPlaying(true)
    expect(clock?.playing).toBe(true)
    expect(clock?.startedAt).toBe(now)
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('restarts from zero after a pause longer than the duration', () => {
    const { player, clocks, onFinished } = makePlayer(false)

    player.setAnimations(seq(makeAnimation()))
    advance(5000)
    player.setPlaying(true)

    const clock = clocks.get('wave')
    player.update()
    expect(clock?.playing).toBe(true)
    expect(onFinished).not.toHaveBeenCalled()

    advance(999)
    player.update()
    expect(onFinished).not.toHaveBeenCalled()

    advance(1)
    player.update()
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(clock?.pausedAt).toBe(1000)
  })

  it('starts a newly added animation from zero while playing', () => {
    const { player, clocks, onFinished } = makePlayer(true)

    player.setAnimations(seq(makeAnimation()))
    advance(100)

    const clock = clocks.get('wave')
    expect(clock?.playing).toBe(true)
    expect(clock?.startedAt).toBe(0)

    player.update()
    expect(clock?.pausedAt).toBe(0)
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('pauses and resumes at the paused position', () => {
    const { player, clocks, onFinished } = makePlayer(true)

    player.setAnimations(seq(makeAnimation()))
    advance(400)
    player.setPlaying(false)

    const clock = clocks.get('wave')
    expect(clock?.playing).toBe(false)
    expect(clock?.pausedAt).toBe(400)

    advance(1000)
    player.setPlaying(true)
    expect(clock?.startedAt).toBe(now - 400)

    advance(599)
    player.update()
    expect(onFinished).not.toHaveBeenCalled()

    advance(1)
    player.update()
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('restarts a finished non-looping animation from zero on the next play', () => {
    const { player, clocks, onFinished } = makePlayer(true)

    player.setAnimations(seq(makeAnimation()))
    advance(1500)
    player.update()

    const clock = clocks.get('wave')
    expect(clock?.playing).toBe(false)
    expect(clock?.pausedAt).toBe(1000)
    expect(onFinished).toHaveBeenCalledTimes(1)

    player.setPlaying(true)
    expect(clock?.playing).toBe(true)
    expect(clock?.startedAt).toBe(now)
    expect(clock?.pausedAt).toBe(0)
  })

  it('seeks a paused animation and reports its position', () => {
    const { player, clocks } = makePlayer(false)

    player.setAnimations(seq(makeAnimation()))
    advance(5000)
    player.seek(250)

    expect(clocks.get('wave')?.playing).toBe(false)
    expect(clocks.get('wave')?.pausedAt).toBe(250)
    expect(player.elapsedOf('wave')).toBe(250)
  })

  it('seeks a playing animation by rebasing its clock', () => {
    const { player, clocks } = makePlayer(true)

    player.setAnimations(seq(makeAnimation()))
    advance(400)
    player.seek(250)

    expect(clocks.get('wave')?.playing).toBe(true)
    expect(player.elapsedOf('wave')).toBe(250)

    advance(100)
    expect(player.elapsedOf('wave')).toBe(350)
  })

  it('clamps the seek target and reports zero for unknown animations', () => {
    const { player, clocks } = makePlayer(false)

    player.setAnimations(seq(makeAnimation()))
    player.seek(-50)
    expect(clocks.get('wave')?.pausedAt).toBe(0)

    player.seek(5000)
    expect(clocks.get('wave')?.pausedAt).toBe(1000)
    expect(player.elapsedOf('missing')).toBe(0)
  })

  it('keeps the clock state for animations that stay selected', () => {
    const { player, clocks } = makePlayer(true)

    player.setAnimations(seq(makeAnimation()))
    advance(400)
    const startedAtBefore = clocks.get('wave')?.startedAt

    player.setAnimations(seq(makeAnimation()))

    const clock = clocks.get('wave')
    expect(clock?.playing).toBe(true)
    expect(clock?.startedAt).toBe(startedAtBefore)
  })

  it('starts a re-added animation from zero instead of its stale end state', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const entry: ActiveCpmAnimation = { animation: makeAnimation({ id: 'gesture' }), startDelayMs: 0 }

    player.setAnimations(seq(entry.animation))
    player.setPlaying(true)
    advance(1500)
    player.update()
    expect(mesh.parent?.position.y).toBe(16)

    player.setAnimations([])
    player.setAnimations(seq(entry.animation))
    expect(mesh.parent?.position.y).toBe(24)
  })

  it('applies the latest speed to clocks added after a speed change', () => {
    const { player, clocks } = makePlayer(false)

    player.setAnimations(seq(makeAnimation({ id: 'a' })))
    player.setSpeed(2)
    player.setAnimations(seq(makeAnimation({ id: 'a' }), makeAnimation({ id: 'b' })))

    expect(clocks.get('a')?.speed).toBe(2)
    expect(clocks.get('b')?.speed).toBe(2)
  })

  it('clears the shared clocks on dispose so a rebuilt player starts animations from zero', () => {
    const { player, clocks } = makePlayer(true)

    player.setAnimations(seq(makeAnimation()))
    expect(clocks.size).toBe(1)

    player.dispose()

    expect(clocks.size).toBe(0)
  })

  it('composes the animation show track with the active layers while a frame is applied', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds)

    player.setAnimations(seq(makeAnimation()))
    expect(mesh.userData.animVisible).toBe(true)
    expect(mesh.visible).toBe(true)

    activeLayerIds.value = []
    player.applyCurrentFrame()
    expect(mesh.visible).toBe(false)

    activeLayerIds.value = [7]
    player.applyCurrentFrame()
    expect(mesh.visible).toBe(true)
  })

  it('hides the mesh when the show track is off even though the layer is active', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds)

    const hiddenPart = makeAnimation({
      frames: [
        { components: [{ storeID: 0, pos: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: false }] },
        { components: [{ storeID: 0, pos: { x: 0, y: 8, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: false }] },
      ],
    })

    player.setAnimations(seq(hiddenPart))

    expect(mesh.userData.animVisible).toBe(false)
    expect(mesh.visible).toBe(false)
  })

  it('restores layer-based visibility after the animations are deselected', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds)

    player.setAnimations(seq(makeAnimation()))
    expect(mesh.visible).toBe(true)

    activeLayerIds.value = []
    player.setAnimations([])
    expect(mesh.visible).toBe(false)

    activeLayerIds.value = [7]
    player.setAnimations([])
    expect(mesh.visible).toBe(true)
  })

  it('keeps a hidden-by-default mesh off at rest even when its layer is active', () => {
    const activeLayerIds = ref<number[]>([7])
    const group = new THREE.Group()
    group.userData.storeID = 0
    group.userData.isRoot = true
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    mesh.userData.layerId = 7
    mesh.userData.defaultVisible = false
    group.add(mesh)

    const player = new CpmAnimationPlayer(indexModelNodes(group), {
      activeLayerIds,
      isPlaying: ref(false),
      onFinished: vi.fn(),
    })

    player.setAnimations([])
    expect(mesh.visible).toBe(false)
  })

  it('keeps a root marked hidden by the model off after a reset', () => {
    const root = new THREE.Group()
    root.userData.storeID = 4
    root.userData.isRoot = true
    root.userData.defaultVisible = false
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))

    const player = new CpmAnimationPlayer(indexModelNodes(root), {
      activeLayerIds: ref<number[]>([]),
      isPlaying: ref(false),
      onFinished: vi.fn(),
    })

    player.setAnimations([])
    expect(root.visible).toBe(false)
  })

  it('keeps editor-hidden nodes off even when a show track turns them on', () => {
    const group = new THREE.Group()
    group.userData.storeID = 0
    group.userData.isRoot = true
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const hiddenStoreIds = ref<ReadonlySet<number>>(new Set([0]))

    const player = new CpmAnimationPlayer(indexModelNodes(group), {
      activeLayerIds: ref<number[]>([]),
      isPlaying: ref(false),
      onFinished: vi.fn(),
      hiddenStoreIds,
    })

    player.setAnimations(seq(makeAnimation()))
    expect(group.visible).toBe(false)

    hiddenStoreIds.value = new Set()
    player.applyCurrentFrame()
    expect(group.visible).toBe(true)
  })

  it('reveals a hidden-by-default mesh when a show track turns it on', () => {
    const activeLayerIds = ref<number[]>([7])
    const group = new THREE.Group()
    group.userData.storeID = 0
    group.userData.isRoot = true
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    mesh.userData.layerId = 7
    mesh.userData.defaultVisible = false
    group.add(mesh)

    const player = new CpmAnimationPlayer(indexModelNodes(group), {
      activeLayerIds,
      isPlaying: ref(false),
      onFinished: vi.fn(),
    })

    player.setAnimations(seq(makeAnimation()))
    expect(mesh.visible).toBe(true)

    activeLayerIds.value = []
    player.applyCurrentFrame()
    expect(mesh.visible).toBe(false)

    activeLayerIds.value = [7]
    player.applyCurrentFrame()
    expect(mesh.visible).toBe(true)

    player.setAnimations([])
    expect(mesh.visible).toBe(false)
  })

  it('ignores show tracks on vanilla part roots so custom content stays visible', () => {
    const activeLayerIds = ref<number[]>([7])
    const group = new THREE.Group()
    group.userData.storeID = 0
    group.userData.isRoot = true
    group.userData.isVanillaPart = true
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    mesh.userData.layerId = 7
    group.add(mesh)

    const player = new CpmAnimationPlayer(indexModelNodes(group), {
      activeLayerIds,
      isPlaying: ref(false),
      onFinished: vi.fn(),
    })

    player.setAnimations(seq(makeAnimation({
      frames: [
        { components: [{ storeID: 0, pos: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: false }] },
        { components: [{ storeID: 0, pos: { x: 0, y: 8, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: false }] },
      ],
    })))

    expect(group.visible).toBe(true)
    expect(mesh.visible).toBe(true)
  })

  it('places keyframes across the full duration and rests on the final pose', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations(seq(makeAnimation({
      id: 'talk',
      duration: 3000,
      interpolator: 'linear_single',
      frames: [frameAt(0), frameAt(8), frameAt(16)],
    })))

    advance(1500)
    player.update()
    expect(mesh.parent?.position.y).toBe(24 - 8)

    advance(1500)
    player.update()
    expect(mesh.parent?.position.y).toBe(24 - 16)

    advance(100)
    player.update()
    expect(mesh.parent?.position.y).toBe(24 - 16)
  })

  it('rests on the final keyframe for smooth non-looping interpolators', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations(seq(makeAnimation({
      id: 'xhand',
      duration: 800,
      interpolator: 'poly_single',
      frames: [frameAt(0), frameAt(8), frameAt(16)],
    })))

    advance(800)
    player.update()
    expect(mesh.parent?.position.y).toBe(24 - 16)
  })

  it('places looping keyframes across the full duration', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations(seq(makeAnimation({
      id: 'blink',
      duration: 1000,
      loop: true,
      interpolator: 'linear_loop',
      frames: [frameAt(0), frameAt(8)],
    })))

    advance(500)
    player.update()
    expect(mesh.parent?.position.y).toBe(24 - 8)

    advance(500)
    player.update()
    expect(mesh.parent?.position.y).toBe(24)
  })

  it('wraps the animation time by the duration for non-looping animations', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations(seq(makeAnimation({
      id: 'wrap',
      duration: 1000,
      loop: false,
      interpolator: 'linear_single',
      frames: [frameAt(0), frameAt(8)],
    })))

    advance(1500)
    player.applyCurrentFrame()
    expect(mesh.parent?.position.y).toBe(24 - 4)
  })

  it('changes visibility on whole frames without interpolating the show track', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameWith = (show: boolean) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show,
      }],
    })

    player.setAnimations(seq(makeAnimation({
      id: 'flash',
      duration: 3000,
      loop: true,
      interpolator: 'linear_loop',
      frames: [frameWith(true), frameWith(false), frameWith(true)],
    })))

    advance(250)
    player.update()
    expect(mesh.visible).toBe(true)

    advance(750)
    player.update()
    expect(mesh.visible).toBe(false)

    advance(1000)
    player.update()
    expect(mesh.visible).toBe(true)
  })

  it('applies a duplicated animation once per frame', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })
    const additive = (id: string, y: number): CPMAnimation =>
      makeAnimation({ id, additive: true, duration: 1000, frames: [frameAt(y), frameAt(y)] })

    player.setAnimations([
      { animation: additive('dance-pre', 8), startDelayMs: 0 },
      { animation: additive('dance-a', 0), startDelayMs: 300 },
      { animation: additive('dance-pre', 8), startDelayMs: 0 },
      { animation: additive('dance-b', 0), startDelayMs: 300 },
    ])

    advance(500)
    player.update()

    expect(mesh.parent?.position.y).toBe(-8)
  })

  it('holds a sequenced animation until its start delay passes', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations([
      { animation: makeAnimation({ id: 'pre', duration: 1000, interpolator: 'linear_single', frames: [frameAt(0), frameAt(0)] }), startDelayMs: 0 },
      { animation: makeAnimation({ id: 'main', duration: 1000, interpolator: 'linear_single', frames: [frameAt(8), frameAt(8)] }), startDelayMs: 1000 },
    ])

    advance(500)
    player.update()
    expect(mesh.parent?.position.y).toBe(24)

    advance(1000)
    player.update()
    expect(mesh.parent?.position.y).toBe(16)
  })

  it('does not apply a paused sequenced animation before its delay', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, false)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations([
      { animation: makeAnimation({ id: 'main', duration: 1000, interpolator: 'linear_single', frames: [frameAt(8), frameAt(8)] }), startDelayMs: 1000 },
    ])

    expect(mesh.parent?.position.y).toBe(0)
  })

  it('keeps the delay when pausing and resuming before the start', () => {
    const activeLayerIds = ref<number[]>([7])
    const { player, mesh } = makePlayerWithModel(activeLayerIds, true)
    const frameAt = (y: number) => ({
      components: [{
        storeID: 0,
        pos: { x: 0, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        show: true,
      }],
    })

    player.setAnimations([
      { animation: makeAnimation({ id: 'main', duration: 1000, interpolator: 'linear_single', frames: [frameAt(8), frameAt(8)] }), startDelayMs: 1000 },
    ])

    advance(500)
    player.update()
    player.setPlaying(false)
    player.setPlaying(true)
    advance(400)
    player.update()
    expect(mesh.parent?.position.y).toBe(0)

    advance(200)
    player.update()
    expect(mesh.parent?.position.y).toBe(16)
  })
})
