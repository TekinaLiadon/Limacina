import * as THREE from 'three'
import type { Ref } from 'vue'

export function configurePixelTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      const {material} = object
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material.dispose()
    }
  })
}

export function removeGroupFromScene(
  scene: Ref<THREE.Scene | null>,
  group: Ref<THREE.Group | null>,
): void {
  if (!group.value || !scene.value) return

  scene.value.remove(group.value)
  disposeObjectTree(group.value)
  group.value = null
}

export interface ManagedTexture {
  load: (url: string, onLoaded: (texture: THREE.Texture, scene: THREE.Scene) => void) => void
  dispose: () => void
}

export function createManagedTextureLoader(scene: Ref<THREE.Scene | null>): ManagedTexture {
  let loadGeneration = 0
  let currentTexture: THREE.Texture | null = null

  return {
    load: (url: string, onLoaded: (texture: THREE.Texture, scene: THREE.Scene) => void): void => {
      if (!scene.value) return
      const generation = ++loadGeneration
      const loader = new THREE.TextureLoader()
      loader.load(url, (texture) => {
        if (generation !== loadGeneration || !scene.value) return
        configurePixelTexture(texture)
        if (currentTexture) currentTexture.dispose()
        currentTexture = texture
        onLoaded(texture, scene.value)
      })
    },
    dispose: (): void => {
      if (currentTexture) currentTexture.dispose()
      currentTexture = null
    },
  }
}
