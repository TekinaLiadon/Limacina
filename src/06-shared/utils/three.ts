import * as THREE from 'three'
import type { Ref } from 'vue'
import { useAsyncRaceGuard } from './useAsyncRaceGuard'
import { reportError } from './reportError'

function configurePixelTexture(texture: THREE.Texture): THREE.Texture {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function isManagedTexture(texture: THREE.Texture): boolean {
  return texture.userData.managed === true
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture && !isManagedTexture(value)) value.dispose()
  }
  material.dispose()
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      const {material} = object
      if (Array.isArray(material)) material.forEach(disposeMaterial)
      else disposeMaterial(material)
    }
  })
}

export function removeGroupFromScene(
  scene: Ref<THREE.Scene | null>,
  group: Ref<THREE.Group | null>,
): void {
  const current = group.value
  if (!current) return

  if (scene.value) scene.value.remove(current)
  disposeObjectTree(current)
  group.value = null
}

export interface ManagedTexture {
  load: (url: string, onLoaded: (texture: THREE.Texture, scene: THREE.Scene) => void) => void
  dispose: () => void
}

export function createManagedTextureLoader(scene: Ref<THREE.Scene | null>): ManagedTexture {
  const guard = useAsyncRaceGuard()
  let currentTexture: THREE.Texture | null = null

  return {
    load: (url: string, onLoaded: (texture: THREE.Texture, scene: THREE.Scene) => void): void => {
      if (!scene.value) return
      const generation = guard.next()
      const loader = new THREE.TextureLoader()
      loader.load(url, (texture) => {
        if (!guard.isCurrent(generation) || !scene.value) {
          texture.dispose()
          return
        }
        configurePixelTexture(texture)
        texture.userData.managed = true
        if (currentTexture) currentTexture.dispose()
        currentTexture = texture
        onLoaded(texture, scene.value)
      }, undefined, () => {
        if (!guard.isCurrent(generation)) return
        reportError(`Не удалось загрузить текстуру: ${url}`)
      })
    },
    dispose: (): void => {
      guard.cancel()
      if (currentTexture) currentTexture.dispose()
      currentTexture = null
    },
  }
}
