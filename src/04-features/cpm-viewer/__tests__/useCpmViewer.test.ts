import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useCpmViewer, type CpmViewerOptions } from '../useCpmViewer'
import type { ActiveCpmAnimation } from '../cpmAnimationPlayer'
import type { CPMAnimation, CPMChild, CPMConfig, CPMData, CPMElement } from '@/05-entities'

const seq = (...animations: CPMAnimation[]): ActiveCpmAnimation[] =>
  animations.map((animation) => ({ animation, startDelayMs: 0 }))
import { DEFAULT_RGB, type ViewerControls } from '@/06-shared'

const textureLoads = vi.hoisted(() => [] as Array<{
  url: string
  resolve: (texture: THREE.Texture) => void
  fail: (error: unknown) => void
}>)

const boxGeometryState = vi.hoisted(() => ({ created: [] as Array<{ disposed: boolean }> }))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  const { createFakeTextureLoader } = await import('@/test-support/fakeTextureLoader')
  class TrackingBoxGeometry extends actual.BoxGeometry {
    disposed = false

    constructor(...args: ConstructorParameters<typeof actual.BoxGeometry>) {
      super(...args)
      boxGeometryState.created.push(this)
    }

    dispose(): void {
      this.disposed = true
      super.dispose()
    }
  }
  return { ...actual, TextureLoader: createFakeTextureLoader(textureLoads), BoxGeometry: TrackingBoxGeometry }
})

const mountedScene = vi.hoisted(() => ({
  current: null as ShallowRef<THREE.Scene | null> | null,
  camera: null as ShallowRef<THREE.PerspectiveCamera | null> | null,
}))
const playerState = vi.hoisted(() => ({
  disposed: 0,
  instances: [] as Array<{ calls: string[] }>,
}))

vi.mock('@/06-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/06-shared')>()
  const { onBeforeUnmount, onMounted, shallowRef } = await import('vue')
  const three = await import('three')
  return {
    ...actual,
    useThreeScene: () => {
      const scene = shallowRef<THREE.Scene | null>(null)
      const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
      mountedScene.current = scene
      mountedScene.camera = camera
      onMounted(() => {
        scene.value = new three.Scene()
        camera.value = new three.PerspectiveCamera()
      })
      onBeforeUnmount(() => {
        scene.value = null
        camera.value = null
      })
      return {
        scene,
        camera,
        renderer: shallowRef<THREE.WebGLRenderer | null>(null),
        getOrbitControls: (): null => null,
      }
    },
  }
})

vi.mock('../cpmAnimationPlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cpmAnimationPlayer')>()
  class FakeCpmAnimationPlayer {
    calls: string[] = []

    constructor(_index?: unknown) {
      playerState.instances.push(this)
    }

    setSpeed(): void {
      this.calls.push('setSpeed')
    }

    setForceLoop(): void {
      this.calls.push('setForceLoop')
    }

    setAnimations(): void {
      this.calls.push('setAnimations')
    }

    setPlaying(): void {
      this.calls.push('setPlaying')
    }

    applyCurrentFrame(): void {
      this.calls.push('applyCurrentFrame')
    }

    seek(): void {
      this.calls.push('seek')
    }

    elapsedOf(): number {
      return 0
    }

    update(): void {
      this.calls.push('update')
    }

    dispose(): void {
      this.calls.push('dispose')
      playerState.disposed += 1
    }
  }
  return { ...actual, CpmAnimationPlayer: FakeCpmAnimationPlayer }
})

function createControls(): ViewerControls {
  return {
    minZoom: 8,
    zoomLevel: ref(22),
    rotationY: ref(0),
    rotationX: ref(13),
    autoRotate: ref(false),
    fitDistance: ref(22),
    zoomIn: (): void => {},
    zoomOut: (): void => {},
    rotateLeft: (): void => {},
    rotateRight: (): void => {},
    rotateUp: (): void => {},
    rotateDown: (): void => {},
    resetZoom: (): void => {},
    resetView: (): void => {},
  }
}

function makeConfig(): CPMConfig {
  return {
    skinSize: { x: 64, y: 64 },
    elements: [
      {
        id: 'head',
        name: 'head',
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        children: [
          {
            name: 'skull',
            size: { x: 8, y: 8, z: 8 },
            offset: { x: 0, y: 0, z: 0 },
            pos: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            storeID: 1,
          },
        ],
      },
    ],
  }
}

function makeConfigWithHiddenChild(): CPMConfig {
  return {
    skinSize: { x: 64, y: 64 },
    elements: [
      {
        id: 'head',
        name: 'head',
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        children: [
          {
            name: 'skull',
            size: { x: 8, y: 8, z: 8 },
            offset: { x: 0, y: 0, z: 0 },
            pos: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            storeID: 1,
          },
          {
            name: 'eyelids',
            size: { x: 8, y: 2, z: 8 },
            offset: { x: 0, y: 0, z: 0 },
            pos: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            storeID: 2,
            hidden: true,
          },
        ],
      },
    ],
  }
}

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'skull',
  size: { x: 8, y: 8, z: 8 },
  offset: { x: 0, y: 0, z: 0 },
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...overrides,
})

const makeConfigWithChildren = (children: CPMChild[]): CPMConfig => ({
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'head',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children,
    },
  ],
})

function makeAnimation(id: string): CPMAnimation {
  return {
    id,
    name: id,
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
    ],
  }
}

function modelGroups(): THREE.Group[] {
  const scene = mountedScene.current
  if (!scene?.value) return []
  return scene.value.children.filter((child): child is THREE.Group => child instanceof THREE.Group)
}

function firstModelMesh(): THREE.Mesh {
  const meshes: THREE.Mesh[] = []
  mountedScene.current?.value?.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object)
  })
  const [mesh] = meshes
  if (!mesh) throw new Error('model mesh was not added to the scene')
  return mesh
}

function modelNodeGroups(): Map<number, THREE.Group> {
  const groups = new Map<number, THREE.Group>()
  mountedScene.current?.value?.traverse((object) => {
    if (object instanceof THREE.Group && typeof object.userData.storeID === 'number') {
      groups.set(object.userData.storeID, object)
    }
  })
  return groups
}

async function resolveLastLoad(texture: THREE.Texture): Promise<void> {
  const load = textureLoads[textureLoads.length - 1]
  if (!load) throw new Error('no pending texture load')
  load.resolve(texture)
  await nextTick()
}

interface ViewerHarness {
  cpmData: Ref<CPMData | null>
  activeAnimations: Ref<ActiveCpmAnimation[]>
  isAnimationPlaying: Ref<boolean>
  container: Ref<HTMLDivElement | null>
  unmount: () => void
}

async function mountViewer(options: CpmViewerOptions = {}): Promise<ViewerHarness> {
  const container = ref<HTMLDivElement | null>(document.createElement('div'))
  const cpmData = ref<CPMData | null>(null)
  const activeAnimations = ref<ActiveCpmAnimation[]>([])
  const isAnimationPlaying = ref(false)
  const { unmount } = withSetup(() => useCpmViewer(
    container,
    cpmData,
    ref<number[]>([]),
    createControls(),
    activeAnimations,
    isAnimationPlaying,
    ref(1),
    ref(false),
    options,
  ))
  return { cpmData, activeAnimations, isAnimationPlaying, container, unmount }
}

async function loadModel(harness: ViewerHarness, textureUrl: string): Promise<void> {
  harness.cpmData.value = { config: makeConfig(), textureUrl }
  await nextTick()
  await resolveLastLoad(new THREE.Texture())
}

async function loadModelWithConfig(harness: ViewerHarness, config: CPMConfig, textureUrl: string): Promise<void> {
  harness.cpmData.value = { config, textureUrl }
  await nextTick()
  await resolveLastLoad(new THREE.Texture())
}

describe('useCpmViewer', () => {
  beforeEach(() => {
    textureLoads.length = 0
    boxGeometryState.created.length = 0
    mountedScene.current = null
    playerState.disposed = 0
    playerState.instances = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((_callback: FrameRequestCallback): number => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds the model to the scene and creates the animation player', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    expect(modelGroups()).toHaveLength(1)
    expect(firstModelMesh().userData.layerId).toBe(1)
    harness.unmount()
  })

  it('marks vanilla part roots for show-track exemption', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    const rootGroup = firstModelMesh().parent?.parent
    expect(rootGroup?.userData.isVanillaPart).toBe(true)
    harness.unmount()
  })

  it('maps storeID for cape and armor roots from the element config', async () => {
    const cube = (name: string, storeID: number): CPMChild => ({
      name,
      storeID,
      size: { x: 4, y: 4, z: 4 },
      offset: { x: 0, y: 0, z: 0 },
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    const root = (id: string, storeID: number): CPMElement => ({
      id,
      name: id,
      storeID,
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children: [cube(`${id}-cube`, storeID)],
    })
    const harness = await mountViewer()
    harness.cpmData.value = {
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [root('head', 100), root('cape', 6), root('armor_helmet', 12)],
      },
      textureUrl: 'model.png',
    }
    await nextTick()
    await resolveLastLoad(new THREE.Texture())

    const [modelRoot] = modelGroups()
    if (!modelRoot) throw new Error('model was not added to the scene')
    const stores = new Map(modelRoot.children.map((group) => [group.name, group.userData.storeID as number | undefined]))
    expect(stores.get('head')).toBe(0)
    expect(stores.get('cape')).toBe(6)
    expect(stores.get('armor_helmet')).toBe(12)
    harness.unmount()
  })

  it('loads the model when cpm data arrives before the scene is created', async () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const cpmData = ref<CPMData | null>({ config: makeConfig(), textureUrl: 'model.png' })
    const { unmount } = withSetup(() => useCpmViewer(
      container,
      cpmData,
      ref<number[]>([]),
      createControls(),
      ref<ActiveCpmAnimation[]>([]),
      ref(false),
      ref(1),
      ref(false),
    ))

    await nextTick()
    expect(textureLoads.length).toBeGreaterThan(0)

    await resolveLastLoad(new THREE.Texture())
    expect(modelGroups()).toHaveLength(1)
    unmount()
  })

  it('reports texture load failures through onTextureError', async () => {
    const onTextureError = vi.fn()
    const harness = await mountViewer({ onTextureError })

    harness.cpmData.value = { config: makeConfig(), textureUrl: 'broken.png' }
    await nextTick()
    const load = textureLoads[textureLoads.length - 1]
    if (!load) throw new Error('no pending texture load')
    load.fail(new Error('decode failed'))
    await nextTick()

    expect(onTextureError).toHaveBeenCalledWith('broken.png')
    harness.unmount()
  })

  it('keeps hidden cubes invisible at rest even when their layer is active', async () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const cpmData = ref<CPMData | null>(null)
    const activeLayers = ref<number[]>([1, 2])
    const { unmount } = withSetup(() => useCpmViewer(
      container,
      cpmData,
      activeLayers,
      createControls(),
      ref<ActiveCpmAnimation[]>([]),
      ref(false),
      ref(1),
      ref(false),
    ))

    cpmData.value = { config: makeConfigWithHiddenChild(), textureUrl: 'model.png' }
    await nextTick()
    await resolveLastLoad(new THREE.Texture())

    const meshes: THREE.Mesh[] = []
    mountedScene.current?.value?.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    expect(meshes.map((mesh) => mesh.visible)).toEqual([true, false])
    unmount()
  })

  it('hides cubes marked hidden in the model editor', async () => {
    const harness = await mountViewer()
    await loadModelWithConfig(harness, makeConfigWithChildren([
      makeChild({ name: 'visible', storeID: 1 }),
      makeChild({ name: 'editor-hidden', storeID: 2, show: false }),
    ]), 'model.png')

    expect(modelNodeGroups().get(1)?.visible).toBe(true)
    expect(modelNodeGroups().get(2)?.visible).toBe(false)
    harness.unmount()
  })

  it('hides custom roots that the model marks hidden', async () => {
    const harness = await mountViewer()
    await loadModelWithConfig(harness, {
      skinSize: { x: 64, y: 64 },
      elements: [{
        id: 'cape',
        name: 'cape',
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        customPart: true,
        show: false,
        storeID: 6,
        children: [makeChild({ name: 'cape-cube', storeID: 7 })],
      }],
    }, 'model.png')

    const [modelRoot] = modelGroups()
    const cape = modelRoot?.children.find((group): boolean => group.userData.storeID === 6)
    expect(cape?.visible).toBe(false)
    harness.unmount()
  })

  it('disposes the previous model when new cpm data arrives', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    const geometryDispose = vi.spyOn(firstModelMesh().geometry, 'dispose')
    await loadModel(harness, 'model2.png')

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(modelGroups()).toHaveLength(1)
    harness.unmount()
  })

  it('disposes the previous animation player when a new model loads', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')
    await loadModel(harness, 'model2.png')

    expect(playerState.disposed).toBe(1)
    harness.unmount()

    expect(playerState.disposed).toBe(2)
  })

  it('disposes the model and the animation player on unmount even though the scene was cleaned up first', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    const geometryDispose = vi.spyOn(firstModelMesh().geometry, 'dispose')

    harness.unmount()

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(playerState.disposed).toBe(1)
  })

  it('removes the model and disposes the player when the cpm data is reset', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    const geometryDispose = vi.spyOn(firstModelMesh().geometry, 'dispose')

    harness.cpmData.value = null
    await nextTick()

    expect(modelGroups()).toHaveLength(0)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(playerState.disposed).toBe(1)

    harness.unmount()

    expect(playerState.disposed).toBe(1)
  })

  it('does not schedule the animation tick without a model or playback', async () => {
    const raf = vi.mocked(requestAnimationFrame)
    const harness = await mountViewer()

    expect(raf).not.toHaveBeenCalled()

    await loadModel(harness, 'model.png')
    expect(raf).not.toHaveBeenCalled()

    harness.unmount()
    expect(raf).not.toHaveBeenCalled()
  })

  it('runs and reschedules the animation tick only while the player exists and playback is on', async () => {
    const raf = vi.mocked(requestAnimationFrame)
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')
    expect(raf).not.toHaveBeenCalled()

    harness.isAnimationPlaying.value = true
    await nextTick()
    expect(raf).toHaveBeenCalledTimes(1)

    const [tick] = raf.mock.calls[0] ?? []
    if (!tick) throw new Error('animation tick was not scheduled')
    tick(16)
    expect(playerState.instances[0]?.calls).toContain('update')
    expect(raf).toHaveBeenCalledTimes(2)

    harness.isAnimationPlaying.value = false
    await nextTick()
    expect(cancelAnimationFrame).toHaveBeenCalled()

    const [nextCallback = null] = raf.mock.calls[1] ?? []
    if (!nextCallback) throw new Error('animation tick was not rescheduled')
    nextCallback(16)
    expect(raf).toHaveBeenCalledTimes(2)
    expect(playerState.instances[0]?.calls.filter((call) => call === 'update')).toHaveLength(1)

    harness.unmount()
  })

  it('stops the animation tick when the model is cleared', async () => {
    const raf = vi.mocked(requestAnimationFrame)
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    harness.isAnimationPlaying.value = true
    await nextTick()
    const [tick] = raf.mock.calls[0] ?? []
    if (!tick) throw new Error('animation tick was not scheduled')
    tick(16)
    expect(raf).toHaveBeenCalledTimes(2)

    harness.cpmData.value = null
    await nextTick()
    expect(cancelAnimationFrame).toHaveBeenCalled()

    const [nextCallback = null] = raf.mock.calls[1] ?? []
    if (!nextCallback) throw new Error('animation tick was not rescheduled')
    nextCallback(16)
    expect(raf).toHaveBeenCalledTimes(2)
    expect(playerState.instances[0]?.calls.filter((call) => call === 'update')).toHaveLength(1)

    harness.unmount()
  })

  it('reports the real playing state when the animation selection changes', async () => {
    const onPlayingChanged = vi.fn()
    const harness = await mountViewer({ onPlayingChanged })
    await loadModel(harness, 'model.png')

    harness.isAnimationPlaying.value = false
    harness.activeAnimations.value = seq(makeAnimation('wave'))
    await nextTick()
    expect(onPlayingChanged).toHaveBeenLastCalledWith(false)

    harness.isAnimationPlaying.value = true
    harness.activeAnimations.value = seq(makeAnimation('wave'), makeAnimation('idle'))
    await nextTick()
    expect(onPlayingChanged).toHaveBeenLastCalledWith(true)

    harness.activeAnimations.value = []
    await nextTick()
    expect(onPlayingChanged).toHaveBeenLastCalledWith(false)
  })

  it('does not rebuild animation tracks when nested frame data changes', async () => {
    const harness = await mountViewer()
    harness.cpmData.value = {
      config: makeConfig(),
      textureUrl: 'model.png',
      animations: [makeAnimation('wave')],
    }
    await nextTick()
    await resolveLastLoad(new THREE.Texture())

    const animation = harness.cpmData.value.animations?.[0]
    if (!animation) throw new Error('animation was not found')
    harness.activeAnimations.value = [{ animation, startDelayMs: 0 }]
    await nextTick()

    const [player] = playerState.instances
    if (!player) throw new Error('player was not created')
    const setAnimationsCount = player.calls.filter((call) => call === 'setAnimations').length

    const component = animation.frames[0]?.components[0]
    if (!component) throw new Error('animation component was not found')
    component.pos.x = 5
    component.pos.y = 7
    await nextTick()

    expect(player.calls.filter((call) => call === 'setAnimations')).toHaveLength(setAnimationsCount)
    harness.unmount()
  })

  it('reapplies animations when the selection list content changes', async () => {
    const harness = await mountViewer()
    harness.cpmData.value = {
      config: makeConfig(),
      textureUrl: 'model.png',
      animations: [makeAnimation('wave'), makeAnimation('idle')],
    }
    await nextTick()
    await resolveLastLoad(new THREE.Texture())

    const [wave, idle] = harness.cpmData.value.animations ?? []
    if (!wave || !idle) throw new Error('animations were not found')
    harness.activeAnimations.value = [{ animation: wave, startDelayMs: 0 }]
    await nextTick()
    const [player] = playerState.instances
    if (!player) throw new Error('player was not created')
    const afterWave = player.calls.filter((call) => call === 'setAnimations').length

    harness.activeAnimations.value = [{ animation: wave, startDelayMs: 0 }, { animation: idle, startDelayMs: 10 }]
    await nextTick()
    expect(player.calls.filter((call) => call === 'setAnimations')).toHaveLength(afterWave + 1)
    harness.unmount()
  })

  it('reports the playing state when animations are selected before the model loads', async () => {
    const onPlayingChanged = vi.fn()
    const harness = await mountViewer({ onPlayingChanged })

    harness.isAnimationPlaying.value = true
    harness.activeAnimations.value = seq(makeAnimation('wave'))
    await nextTick()
    expect(onPlayingChanged).toHaveBeenCalledWith(true)
    expect(playerState.instances).toHaveLength(0)

    await loadModel(harness, 'model.png')
    expect(playerState.instances).toHaveLength(1)
    expect(playerState.instances[0]?.calls).toContain('setAnimations')
    expect(playerState.instances[0]?.calls).toContain('setPlaying')
  })

  it('disposes the BoxGeometry replaced by the extruded geometry right away', async () => {
    const harness = await mountViewer()
    await loadModelWithConfig(harness, makeConfigWithChildren([
      makeChild({ name: 'plain', storeID: 1 }),
      makeChild({
        name: 'perface',
        storeID: 2,
        faceUV: { north: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '0', autoUV: true } },
      }),
      makeChild({ name: 'extruded', storeID: 3, extrude: true }),
    ]), 'model.png')

    const [plain, perFace, extruded] = boxGeometryState.created
    expect(plain?.disposed).toBe(false)
    expect(perFace?.disposed).toBe(false)
    expect(extruded?.disposed).toBe(true)
    harness.unmount()
  })

  it('does not accumulate undisposed BoxGeometry across model reloads', async () => {
    const harness = await mountViewer()
    const config = makeConfigWithChildren([
      makeChild({ name: 'plain', storeID: 1 }),
      makeChild({
        name: 'perface',
        storeID: 2,
        faceUV: { north: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '0', autoUV: true } },
      }),
      makeChild({ name: 'extruded', storeID: 3, extrude: true }),
    ])
    await loadModelWithConfig(harness, config, 'model.png')
    await loadModelWithConfig(harness, config, 'model2.png')

    harness.unmount()

    expect(boxGeometryState.created.filter((geometry) => !geometry.disposed)).toEqual([])
  })

  it('renders textureless cubes without a valid color in the shared default color', async () => {
    const harness = await mountViewer()
    await loadModelWithConfig(harness, makeConfigWithChildren([
      makeChild({ name: 'invalid', storeID: 1, texture: false, color: '80808080' }),
      makeChild({ name: 'missing', storeID: 2, texture: false }),
    ]), 'model.png')

    const meshes: THREE.Mesh[] = []
    mountedScene.current?.value?.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    const colors = meshes.map((mesh) => (mesh.material as THREE.MeshLambertMaterial).color.getHex())
    expect(colors).toEqual([DEFAULT_RGB, DEFAULT_RGB])
    harness.unmount()
  })
})
