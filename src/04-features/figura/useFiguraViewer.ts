import { onBeforeUnmount, watch, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import type { ViewerControls } from '@/06-shared'
import { useViewerModel } from '@/04-features/viewer/useViewerModel'
import { fitToView } from '@/04-features/viewer/useViewerCamera'
import { buildFiguraModel } from './figuraModelBuilder'
import type { FiguraModel } from './figuraParser'

const MISSING_TEXTURE_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII='

export interface FiguraViewerSource {
  model: FiguraModel
  texturePng: Uint8Array | null
}

export interface FiguraViewerOptions {
  onTextureError?: (url: string) => void
  enableZoom?: boolean
}

export function useFiguraViewer(
  container: Ref<HTMLDivElement | null>,
  source: Ref<FiguraViewerSource | null>,
  controls: ViewerControls,
  options: FiguraViewerOptions = {},
): { modelGroup: ShallowRef<THREE.Group | null> } {
  let currentModel: FiguraModel | null = null
  let textureUrl: string | null = null

  function releaseTextureUrl(): void {
    if (textureUrl === null) return
    URL.revokeObjectURL(textureUrl)
    textureUrl = null
  }

  function fitModel(api: Parameters<typeof fitToView>[0]): void {
    const radius = api.modelBoundingSphereRadius()
    if (radius === null || radius <= 0) return
    fitToView(api)
  }

  const { modelGroup, loadModel, clearModel } = useViewerModel(
    container,
    controls,
    {
      build: (texture: THREE.Texture): THREE.Group =>
        currentModel ? buildFiguraModel(currentModel, texture) : new THREE.Group(),
      onModelShown: (_model, _texture, api): void => {
        fitModel(api)
      },
      onTextureError: (url: string): void => {
        options.onTextureError?.(url)
      },
      enableZoom: options.enableZoom ?? false,
    },
  )

  function applySource(next: FiguraViewerSource | null): void {
    currentModel = next?.model ?? null
    releaseTextureUrl()
    if (next === null) {
      clearModel()
      return
    }
    if (next.texturePng === null) {
      loadModel(MISSING_TEXTURE_URL)
      return
    }
    textureUrl = URL.createObjectURL(new Blob([next.texturePng], { type: 'image/png' }))
    loadModel(textureUrl)
  }

  watch(source, (next: FiguraViewerSource | null): void => {
    applySource(next)
  }, { immediate: true })

  onBeforeUnmount(() => {
    releaseTextureUrl()
    clearModel()
  })

  return { modelGroup }
}
