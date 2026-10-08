import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ref, type Ref } from 'vue'
import * as THREE from 'three'
import type { CPMAnimation } from '@/05-entities'
import { CpmAnimationPlayer, indexModelNodes, type ActiveCpmAnimation, type NodeIndex, type SharedClock } from '../cpmAnimationPlayer'

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
    expect(mesh.parent?.position.y).toBe(24 - 4)

    advance(500)
    player.update()
    expect(mesh.parent?.position.y).toBe(24)
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
