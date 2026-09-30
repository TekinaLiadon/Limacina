import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useCpmViewer } from './useCpmViewer'
import type { CPMAnimation, CPMConfig, CPMData } from '@/05-entities'
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
const playerState = vi.hoisted(() => ({ disposed: 0 }))

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

vi.mock('./cpmAnimationPlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cpmAnimationPlayer')>()
  class FakeCpmAnimationPlayer {
    setSpeed(): void {}
    setForceLoop(): void {}
    setAnimations(): void {}
    setPlaying(): void {}
    applyCurrentFrame(): void {}
    update(): void {}
    dispose(): void {
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

async function mountViewer(): Promise<{ cpmData: Ref<CPMData | null>; unmount: () => void }> {
  const container = ref<HTMLDivElement | null>(document.createElement('div'))
  const cpmData = ref<CPMData | null>(null)
  const { unmount } = withSetup(() => useCpmViewer(
    container,
    cpmData,
    ref<number[]>([]),
    createControls(),
    ref<CPMAnimation[]>([]),
    ref(false),
    ref(1),
    ref(false),
  ))
  return { cpmData, unmount }
}

async function loadModel(harness: { cpmData: Ref<CPMData | null> }, textureUrl: string): Promise<void> {
  harness.cpmData.value = { config: makeConfig(), textureUrl }
  await nextTick()
  await resolveLastLoad(new THREE.Texture())
}

describe('useCpmViewer', () => {
  beforeEach(() => {
    textureLoads.length = 0
    mountedScene.current = null
    playerState.disposed = 0
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

  it('disposes the previous model when new cpm data arrives', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    const geometryDispose = vi.spyOn(firstModelMesh().geometry, 'dispose')
    await loadModel(harness, 'model2.png')

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(modelGroups()).toHaveLength(1)
    harness.unmount()
  })

  it('disposes the model and the animation player on unmount even though the scene was cleaned up first', async () => {
    const harness = await mountViewer()
    await loadModel(harness, 'model.png')

    const geometryDispose = vi.spyOn(firstModelMesh().geometry, 'dispose')

    harness.unmount()

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(playerState.disposed).toBe(1)
  })
})
