import { onBeforeUnmount, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { createManagedTextureLoader, removeGroupFromScene, useThreeScene, type ViewerControls } from '@/06-shared'
import { useViewerCamera } from './useViewerCamera'

export interface ViewerModelApi {
  camera: ShallowRef<THREE.PerspectiveCamera | null>
  setFitDistance: (distance: number) => void
  modelBoundingSphereRadius: () => number | null
}

export interface ViewerModelOptions {
  build: (texture: THREE.Texture, scene: THREE.Scene) => THREE.Group
  onModelShown: (group: THREE.Group, texture: THREE.Texture, api: ViewerModelApi) => void
  onModelCleared?: () => void
}

export function useViewerModel(
  container: Ref<HTMLDivElement | null>,
  controls: ViewerControls,
  options: ViewerModelOptions,
): {
  modelGroup: ShallowRef<THREE.Group | null>
  loadModel: (url: string) => void
  showModel: (texture: THREE.Texture) => void
  rebuildModel: () => void
  clearModel: () => void
} {
  const { scene, camera, getOrbitControls } = useThreeScene(container, { enableZoom: false, autoRotate: false })
  const modelGroup = shallowRef<THREE.Group | null>(null)
  const textureLoader = createManagedTextureLoader(scene)
  let currentTexture: THREE.Texture | null = null
  let currentUrl: string | null = null

  const api: ViewerModelApi = {
    camera,
    ...useViewerCamera(
      { camera, getOrbitControls },
      modelGroup,
      controls,
    ),
  }

  function showModel(texture: THREE.Texture): void {
    const target = scene.value
    if (!target) return

    removeGroupFromScene(scene, modelGroup)
    const model = options.build(texture, target)
    target.add(model)
    modelGroup.value = model
    currentTexture = texture
    options.onModelShown(model, texture, api)
  }

  function clearModel(): void {
    removeGroupFromScene(scene, modelGroup)
    currentTexture = null
    currentUrl = null
    options.onModelCleared?.()
  }

  function rebuildModel(): void {
    if (currentTexture) showModel(currentTexture)
  }

  function loadModel(url: string): void {
    currentUrl = url
    textureLoader.load(url, (texture) => {
      showModel(texture)
    })
  }

  watch(scene, (s) => {
    if (s && currentUrl) loadModel(currentUrl)
  })

  onBeforeUnmount(() => {
    clearModel()
    textureLoader.dispose()
  })

  return { modelGroup, loadModel, showModel, rebuildModel, clearModel }
}
