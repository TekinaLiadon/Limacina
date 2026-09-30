import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { createManagedTextureLoader, removeGroupFromScene } from './three'

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

function makeTexture(): THREE.Texture {
  const texture = new THREE.Texture()
  return texture
}

describe('createManagedTextureLoader', () => {
  beforeEach(() => {
    textureLoads.length = 0
  })

  it('disposes the texture of a load that lost the race', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const managed = createManagedTextureLoader(scene)
    const firstLoaded = vi.fn()
    const secondLoaded = vi.fn()

    managed.load('first.png', firstLoaded)
    managed.load('second.png', secondLoaded)

    const staleTexture = makeTexture()
    const staleDispose = vi.spyOn(staleTexture, 'dispose')
    textureLoads[0]?.resolve(staleTexture)

    expect(staleDispose).toHaveBeenCalledOnce()
    expect(firstLoaded).not.toHaveBeenCalled()

    const currentTexture = makeTexture()
    textureLoads[1]?.resolve(currentTexture)

    expect(secondLoaded).toHaveBeenCalledWith(currentTexture, scene.value)
  })

  it('disposes the texture when the scene is gone by the time the load resolves', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const managed = createManagedTextureLoader(scene)
    const onLoaded = vi.fn()

    managed.load('skin.png', onLoaded)
    scene.value = null

    const texture = makeTexture()
    const disposeSpy = vi.spyOn(texture, 'dispose')
    textureLoads[0]?.resolve(texture)

    expect(disposeSpy).toHaveBeenCalledOnce()
    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('disposes each texture exactly once across stale and dispose paths', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const managed = createManagedTextureLoader(scene)
    const onLoaded = vi.fn()

    managed.load('a.png', onLoaded)
    managed.load('b.png', onLoaded)

    const staleTexture = makeTexture()
    const staleDispose = vi.spyOn(staleTexture, 'dispose')
    textureLoads[0]?.resolve(staleTexture)
    expect(staleDispose).toHaveBeenCalledOnce()

    const currentTexture = makeTexture()
    const currentDispose = vi.spyOn(currentTexture, 'dispose')
    textureLoads[1]?.resolve(currentTexture)
    expect(onLoaded).toHaveBeenCalledOnce()

    managed.dispose()
    managed.dispose()

    expect(currentDispose).toHaveBeenCalledOnce()
    expect(staleDispose).toHaveBeenCalledOnce()
  })
})

describe('removeGroupFromScene', () => {
  beforeEach(() => {
    textureLoads.length = 0
  })

  function makeModel(map: THREE.Texture): {
    group: THREE.Group
    geometry: THREE.BoxGeometry
    material: THREE.MeshLambertMaterial
  } {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshLambertMaterial({ map })
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geometry, material))
    return { group, geometry, material }
  }

  it('removes the group from the scene and disposes its resources', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const { group, geometry, material } = makeModel(new THREE.Texture())
    const groupRef = shallowRef<THREE.Group | null>(group)
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')

    removeGroupFromScene(scene, groupRef)

    expect(scene.value?.children).not.toContain(group)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(groupRef.value).toBeNull()
  })

  it('disposes the group even when the scene has already been cleaned up', () => {
    const scene = ref<THREE.Scene | null>(null)
    const { group, geometry, material } = makeModel(new THREE.Texture())
    const groupRef = shallowRef<THREE.Group | null>(group)
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')

    removeGroupFromScene(scene, groupRef)

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(groupRef.value).toBeNull()
  })

  it('ignores a missing group', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const groupRef = shallowRef<THREE.Group | null>(null)

    expect(() => removeGroupFromScene(scene, groupRef)).not.toThrow()
    expect(groupRef.value).toBeNull()
  })

  it('keeps a loader-managed texture alive until the loader disposes it', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const managed = createManagedTextureLoader(scene)
    const onLoaded = vi.fn()

    managed.load('skin.png', onLoaded)
    const texture = makeTexture()
    const textureDispose = vi.spyOn(texture, 'dispose')
    textureLoads[0]?.resolve(texture)

    const { group } = makeModel(texture)
    const groupRef = shallowRef<THREE.Group | null>(group)
    removeGroupFromScene(scene, groupRef)

    expect(onLoaded).toHaveBeenCalledOnce()
    expect(textureDispose).not.toHaveBeenCalled()

    managed.dispose()
    expect(textureDispose).toHaveBeenCalledOnce()
  })

  it('still disposes a texture that does not belong to the loader', () => {
    const scene = ref<THREE.Scene | null>(new THREE.Scene())
    const texture = makeTexture()
    const textureDispose = vi.spyOn(texture, 'dispose')
    const { group } = makeModel(texture)
    const groupRef = shallowRef<THREE.Group | null>(group)

    removeGroupFromScene(scene, groupRef)

    expect(textureDispose).toHaveBeenCalledOnce()
  })
})
