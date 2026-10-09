import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useCpmViewer, type CpmViewerOptions } from '../useCpmViewer'
import type { ActiveCpmAnimation } from '../cpmAnimationPlayer'
import type { CPMAnimation, CPMConfig, CPMData } from '@/05-entities'

const seq = (...animations: CPMAnimation[]): ActiveCpmAnimation[] =>
  animations.map((animation) => ({ animation, startDelayMs: 0 }))
import type { ViewerControls } from '@/06-shared'

const textureLoads = vi.hoisted(() => [] as Array<{
  url: string
  resolve: (texture: THREE.Texture) => void
  fail: (error: unknown) => void
}>)

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeTextureLoader {
    load(
      url: string,
      onLoad: (texture: THREE.Texture) => void,
      _onProgress?: undefined,
      onError?: (error: unknown) => void,
    ): void {
      textureLoads.push({
        url,
        resolve: (texture) => onLoad(texture),
        fail: (error) => onError?.(error),
      })
    }
  }
  return { ...actual, TextureLoader: FakeTextureLoader }
})

const mountedScene = vi.hoisted(() => ({ current: null as ShallowRef<THREE.Scene | null> | null }))
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

    constructor() {
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
  return { cpmData, activeAnimations, isAnimationPlaying, unmount }
}

async function loadModel(harness: ViewerHarness, textureUrl: string): Promise<void> {
  harness.cpmData.value = { config: makeConfig(), textureUrl }
  await nextTick()
  await resolveLastLoad(new THREE.Texture())
}

describe('useCpmViewer', () => {
  beforeEach(() => {
    textureLoads.length = 0
    mountedScene.current = null
    playerState.disposed = 0
    playerState.instances = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((): number => 1))
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
})
