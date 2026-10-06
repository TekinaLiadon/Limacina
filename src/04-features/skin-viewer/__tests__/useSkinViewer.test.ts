import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useSkinViewer } from '../useSkinViewer'
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

function createControls(): ViewerControls {
  return {
    minZoom: 5,
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

function makeSkinTexture(): THREE.Texture {
  const texture = new THREE.Texture()
  texture.image = { width: 64, height: 64 }
  return texture
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

async function mountViewer(): Promise<{ skinUrl: Ref<string>; slim: Ref<boolean>; unmount: () => void }> {
  const container = ref<HTMLDivElement | null>(document.createElement('div'))
  const skinUrl = ref('')
  const slim = ref(false)
  const { unmount } = withSetup(() => useSkinViewer(container, skinUrl, createControls(), slim))
  return { skinUrl, slim, unmount }
}

async function loadSkin(skinUrl: Ref<string>, texture: THREE.Texture): Promise<void> {
  skinUrl.value = 'skin.png'
  await nextTick()
  await resolveLastLoad(texture)
}

describe('useSkinViewer', () => {
  beforeEach(() => {
    textureLoads.length = 0
    mountedScene.current = null
  })

  it('loads the model when mounted with the skin url already set', async () => {
    const container = ref<HTMLDivElement | null>(document.createElement('div'))
    const skinUrl = ref('skin.png')
    const slim = ref(false)
    const { unmount } = withSetup(() => useSkinViewer(container, skinUrl, createControls(), slim))

    await nextTick()

    expect(textureLoads).toHaveLength(1)
    await resolveLastLoad(makeSkinTexture())
    expect(modelGroups()).toHaveLength(1)
    unmount()
  })

  it('removes the model from the scene when the skin url is reset', async () => {
    const { skinUrl, unmount } = await mountViewer()
    await loadSkin(skinUrl, makeSkinTexture())

    const geometryDispose = vi.spyOn(firstModelMesh().geometry, 'dispose')

    skinUrl.value = ''
    await nextTick()

    expect(modelGroups()).toHaveLength(0)
    expect(geometryDispose).toHaveBeenCalledOnce()
    unmount()
  })

  it('keeps the current texture alive and rebuilds the model when slim changes', async () => {
    const { skinUrl, slim, unmount } = await mountViewer()
    const texture = makeSkinTexture()
    const textureDispose = vi.spyOn(texture, 'dispose')
    await loadSkin(skinUrl, texture)

    const [groupBefore] = modelGroups()
    if (!groupBefore) throw new Error('model was not added to the scene')

    slim.value = true
    await nextTick()

    const groups = modelGroups()
    expect(textureDispose).not.toHaveBeenCalled()
    expect(groups).toHaveLength(1)
    expect(groups[0]).toBeTruthy()
    expect(groups[0]).not.toBe(groupBefore)
    unmount()
  })

  it('disposes the model on unmount even though the scene was cleaned up first', async () => {
    const { skinUrl, unmount } = await mountViewer()
    await loadSkin(skinUrl, makeSkinTexture())

    const mesh = firstModelMesh()
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material as THREE.MeshLambertMaterial, 'dispose')

    unmount()

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalled()
  })
})
