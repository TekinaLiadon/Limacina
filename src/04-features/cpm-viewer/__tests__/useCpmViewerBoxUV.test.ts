import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useCpmViewer } from '../useCpmViewer'
import type { ActiveCpmAnimation } from '../cpmAnimationPlayer'
import type { CPMChild, CPMConfig, CPMData } from '@/05-entities'
import type { ViewerControls } from '@/06-shared'
import femaleBodyConfigRaw from '../../cpm-presets/assets/female-body.config.json?raw'

const textureLoads = vi.hoisted(() => [] as Array<{
  url: string
  resolve: (texture: THREE.Texture) => void
  fail: (error: unknown) => void
}>)

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  const { createFakeTextureLoader } = await import('@/test-support/fakeTextureLoader')
  return { ...actual, TextureLoader: createFakeTextureLoader(textureLoads) }
})

const mountedScene = vi.hoisted(() => ({
  current: null as ShallowRef<THREE.Scene | null> | null,
  camera: null as ShallowRef<THREE.PerspectiveCamera | null> | null,
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
    setSpeed(): void {}
    setForceLoop(): void {}
    setAnimations(): void {}
    setPlaying(): void {}
    applyCurrentFrame(): void {}
    update(): void {}
    dispose(): void {}
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

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'arm',
  size: { x: 4, y: 12, z: 4 },
  offset: { x: -2, y: -2, z: -2 },
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...overrides,
})

function makeConfig(children: CPMChild[]): CPMConfig {
  return {
    skinSize: { x: 64, y: 64 },
    elements: [
      {
        id: 'right_arm',
        name: 'right_arm',
        pos: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        children,
      },
    ],
  }
}

async function mountViewer(): Promise<{ cpmData: { value: CPMData | null }; unmount: () => void }> {
  const container = ref<HTMLDivElement | null>(document.createElement('div'))
  const cpmData = ref<CPMData | null>(null)
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
  return { cpmData, unmount }
}

async function loadModel(config: CPMConfig): Promise<{ unmount: () => void }> {
  const harness = await mountViewer()
  harness.cpmData.value = { config, textureUrl: 'model.png' }
  await nextTick()
  const load = textureLoads[textureLoads.length - 1]
  if (!load) throw new Error('no pending texture load')
  load.resolve(new THREE.Texture())
  await nextTick()
  return harness
}

const FACES = ['east', 'west', 'up', 'down', 'north', 'south'] as const
type FaceName = (typeof FACES)[number]

function faceAtlasRect(mesh: THREE.Mesh, face: FaceName): number[] {
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
  const index = FACES.indexOf(face)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 4; i++) {
    xs.push(uv.getX(index * 4 + i) * 64)
    ys.push((1 - uv.getY(index * 4 + i)) * 64)
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(
    (value) => Math.round(value * 1000) / 1000,
  )
}

function meshesByName(): Map<string, THREE.Mesh> {
  const meshes = new Map<string, THREE.Mesh>()
  mountedScene.current?.value?.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const parentName = object.parent?.name ?? ''
      if (!meshes.has(parentName)) meshes.set(parentName, object)
    }
  })
  return meshes
}

async function singleMesh(config: CPMConfig): Promise<{ mesh: THREE.Mesh; unmount: () => void }> {
  const harness = await loadModel(config)
  const meshes = meshesByName()
  const mesh = meshes.get('arm')
  if (!mesh) throw new Error('куб руки не построен')
  return { mesh, unmount: harness.unmount }
}

describe('useCpmViewer box UV', () => {
  beforeEach(() => {
    textureLoads.length = 0
    mountedScene.current = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((_callback: FrameRequestCallback): number => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('кладёт ванильные регионы руки на свои грани: фронт на south, правый бок на east', async () => {
    const { mesh, unmount } = await singleMesh(makeConfig([
      makeChild({ name: 'arm', u: 40, v: 16, textureSize: 1 }),
    ]))

    expect(faceAtlasRect(mesh, 'east')).toEqual([40, 20, 44, 32])
    expect(faceAtlasRect(mesh, 'south')).toEqual([44, 20, 48, 32])
    expect(faceAtlasRect(mesh, 'west')).toEqual([48, 20, 52, 32])
    expect(faceAtlasRect(mesh, 'north')).toEqual([52, 20, 56, 32])
    expect(faceAtlasRect(mesh, 'up')).toEqual([44, 16, 48, 20])
    expect(faceAtlasRect(mesh, 'down')).toEqual([48, 16, 52, 20])
    unmount()
  })

  it('руки пресета female-body семплят фронт и бок своих регионов рук, а не развёрнутые на 180°', async () => {
    const config = JSON.parse(femaleBodyConfigRaw) as CPMConfig
    const { unmount } = await loadModel(config)
    const meshes = meshesByName()

    const rightArm = meshes.get('Right Arm')
    if (!rightArm) throw new Error('куб Right Arm не построен')
    expect(faceAtlasRect(rightArm, 'south')).toEqual([44, 20, 47, 32])
    expect(faceAtlasRect(rightArm, 'east')).toEqual([40, 20, 44, 32])

    const rightArmLayer = meshes.get('Right Arm Layer')
    if (!rightArmLayer) throw new Error('куб Right Arm Layer не построен')
    expect(faceAtlasRect(rightArmLayer, 'south')).toEqual([45, 37, 49, 50])
    expect(faceAtlasRect(rightArmLayer, 'east')).toEqual([40, 37, 45, 50])

    const leftArm = meshes.get('Left Arm')
    if (!leftArm) throw new Error('куб Left Arm не построен')
    expect(faceAtlasRect(leftArm, 'south')).toEqual([36, 52, 39, 64])
    expect(faceAtlasRect(leftArm, 'east')).toEqual([32, 52, 36, 64])

    const leftArmLayer = meshes.get('Left Arm Layer')
    if (!leftArmLayer) throw new Error('куб Left Arm Layer не построен')
    expect(faceAtlasRect(leftArmLayer, 'south')).toEqual([52, 52, 55, 64])
    unmount()
  })

  it('зеркальный куб после свапа получает внешнюю колонку на west, внутреннюю на east', async () => {
    const { mesh, unmount } = await singleMesh(makeConfig([
      makeChild({ name: 'arm', u: 40, v: 16, textureSize: 1, mirror: true }),
    ]))

    expect(faceAtlasRect(mesh, 'east')).toEqual([48, 20, 52, 32])
    expect(faceAtlasRect(mesh, 'west')).toEqual([40, 20, 44, 32])
    expect(faceAtlasRect(mesh, 'south')).toEqual([44, 20, 48, 32])
    expect(faceAtlasRect(mesh, 'north')).toEqual([52, 20, 56, 32])
    unmount()
  })
})
