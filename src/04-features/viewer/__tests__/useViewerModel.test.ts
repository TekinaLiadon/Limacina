import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { useViewerModel } from '../useViewerModel'
import type { ViewerControls } from '@/06-shared'

const textureLoads = vi.hoisted(() => [] as Array<{
  url: string
  resolve: (texture: THREE.Texture) => void
}>)

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class FakeTextureLoader {
    load(
      url: string,
      onLoad: (texture: THREE.Texture) => void,
    ): void {
      textureLoads.push({
        url,
        resolve: (texture) => onLoad(texture),
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

function makeTexture(): THREE.Texture {
  const texture = new THREE.Texture()
  texture.image = { width: 64, height: 64 }
  return texture
}

function modelGroups(): THREE.Group[] {
  const scene = mountedScene.current
  if (!scene?.value) return []
  return scene.value.children.filter((child): child is THREE.Group => child instanceof THREE.Group)
}

async function resolveLastLoad(texture: THREE.Texture): Promise<void> {
  const load = textureLoads[textureLoads.length - 1]
  if (!load) throw new Error('no pending texture load')
  load.resolve(texture)
  await nextTick()
}

interface ViewerModelHarness {
  modelGroup: ShallowRef<THREE.Group | null>
  loadModel: (url: string) => void
  clearModel: () => void
  rebuildModel: () => void
  unmount: () => void
}

function mountModel(): ViewerModelHarness {
  const container = ref<HTMLDivElement | null>(document.createElement('div'))
  const { result, unmount } = withSetup(() => useViewerModel(
    container,
    createControls(),
    {
      build: (texture): THREE.Group => {
        const group = new THREE.Group()
        group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: texture })))
        return group
      },
      onModelShown: (): void => {},
    },
  ))
  return {
    modelGroup: result.modelGroup,
    loadModel: result.loadModel,
    clearModel: result.clearModel,
    rebuildModel: result.rebuildModel,
    unmount,
  }
}

function firstModelMesh(group: THREE.Group): THREE.Mesh {
  const [mesh] = group.children
  if (!(mesh instanceof THREE.Mesh)) throw new Error('model mesh is missing')
  return mesh
}

describe('useViewerModel', () => {
  beforeEach(() => {
    textureLoads.length = 0
    mountedScene.current = null
  })

  it('builds and adds the model when the texture resolves', async () => {
    const model = mountModel()
    model.loadModel('skin.png')
    await nextTick()
    await resolveLastLoad(makeTexture())

    expect(modelGroups()).toHaveLength(1)
    expect(model.modelGroup.value).not.toBeNull()
    model.unmount()
  })

  it('disposes the previous model when the next texture resolves', async () => {
    const model = mountModel()
    model.loadModel('first.png')
    await nextTick()
    await resolveLastLoad(makeTexture())

    const geometryDispose = vi.spyOn(firstModelMesh(model.modelGroup.value as THREE.Group).geometry, 'dispose')
    model.loadModel('second.png')
    await nextTick()
    await resolveLastLoad(makeTexture())

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(modelGroups()).toHaveLength(1)
    model.unmount()
  })

  it('clears the model', async () => {
    const model = mountModel()
    model.loadModel('skin.png')
    await nextTick()
    await resolveLastLoad(makeTexture())

    model.clearModel()
    await nextTick()

    expect(modelGroups()).toHaveLength(0)
    expect(model.modelGroup.value).toBeNull()
    model.unmount()
  })

  it('reloads the model when the scene reattaches', async () => {
    const model = mountModel()
    model.loadModel('skin.png')
    await nextTick()
    await resolveLastLoad(makeTexture())
    expect(modelGroups()).toHaveLength(1)

    const scene = mountedScene.current
    if (!scene) throw new Error('scene ref is missing')
    scene.value = new THREE.Scene()
    await nextTick()
    await resolveLastLoad(makeTexture())

    expect(modelGroups()).toHaveLength(1)
    model.unmount()
  })

  it('rebuilds the model from the current texture', async () => {
    const model = mountModel()
    model.loadModel('skin.png')
    await nextTick()
    await resolveLastLoad(makeTexture())

    const before = model.modelGroup.value
    model.rebuildModel()
    await nextTick()

    expect(modelGroups()).toHaveLength(1)
    expect(model.modelGroup.value).not.toBe(before)
    model.unmount()
  })

  it('disposes the model on unmount even though the scene was cleaned up first', async () => {
    const model = mountModel()
    model.loadModel('skin.png')
    await nextTick()
    await resolveLastLoad(makeTexture())

    const geometryDispose = vi.spyOn(firstModelMesh(model.modelGroup.value as THREE.Group).geometry, 'dispose')

    model.unmount()

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(modelGroups()).toHaveLength(0)
  })
})
