import { watch, onBeforeUnmount, type Ref } from 'vue'
import * as THREE from 'three'
import type { ViewerControls } from '@/06-shared'
import { useViewerModel } from '@/04-features/viewer/useViewerModel'
import { fitToView } from '@/04-features/viewer/useViewerCamera'
import type { CPMData } from '@/05-entities'
import { CpmAnimationPlayer, indexModelNodes, type ActiveCpmAnimation, type NodeIndex, type SharedClock } from './cpmAnimationPlayer'
import { buildCpmModel } from './cpmModelBuilder'
import { computeMeshVisible } from './meshVisibility'

export interface CpmViewerOptions {
  onPlayingChanged?: (playing: boolean) => void
  onAnimationFinished?: () => void
  onTextureError?: (url: string) => void
}

export function useCpmViewer(
    container: Ref<HTMLDivElement | null>,
    cpmData: Ref<CPMData | null>,
    activeLayerIds: Ref<number[]>,
    controls: ViewerControls,
    activeAnimations: Ref<ActiveCpmAnimation[]>,
    isAnimationPlaying: Ref<boolean>,
    animationSpeed: Ref<number>,
    isAnimationLooped: Ref<boolean>,
    options: CpmViewerOptions = {},
) {
  const animationClocks = new Map<string, SharedClock>()
  let player: CpmAnimationPlayer | null = null
  let currentData: CPMData | null = null
  let currentIndex: NodeIndex | null = null
  let tickId = 0

  const { modelGroup, loadModel, clearModel } = useViewerModel(
    container,
    controls,
    {
      build: (texture: THREE.Texture): THREE.Group =>
        currentData ? buildCpmModel(currentData.config, texture) : new THREE.Group(),
      onModelShown: (model, _texture, api): void => {
        player?.dispose()
        currentIndex = indexModelNodes(model)
        player = new CpmAnimationPlayer(currentIndex, {
          activeLayerIds,
          isPlaying: isAnimationPlaying,
          onFinished: () => {
            options.onAnimationFinished?.()
          },
        }, animationClocks)

        player.setSpeed(animationSpeed.value)
        player.setForceLoop(isAnimationLooped.value)
        player.setAnimations(activeAnimations.value)
        player.setPlaying(isAnimationPlaying.value)

        updateVisibility()
        syncAnimationTick()
        fitToView(api)
      },
      onModelCleared: (): void => {
        player?.dispose()
        player = null
        currentIndex = null
        syncAnimationTick()
      },
      onTextureError: (url: string): void => {
        options.onTextureError?.(url)
      },
    },
  )

  function updateVisibility(): void {
    if (!modelGroup.value) return

    modelGroup.value.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const layerId = object.userData.layerId as number | undefined
        const animVisible = object.userData.animVisible !== false
        object.visible = computeMeshVisible(
          animVisible,
          layerId,
          activeLayerIds.value,
        )
      }
    })

    if (player && activeAnimations.value.length > 0) {
      player.applyCurrentFrame()
    }
  }

  function stopAnimationTick(): void {
    if (tickId !== 0) {
      cancelAnimationFrame(tickId)
      tickId = 0
    }
  }

  function tickAnimation(): void {
    tickId = 0
    if (player === null || !isAnimationPlaying.value) return
    player.update()
    tickId = requestAnimationFrame(tickAnimation)
  }

  function syncAnimationTick(): void {
    if (player !== null && isAnimationPlaying.value) {
      if (tickId === 0) tickId = requestAnimationFrame(tickAnimation)
      return
    }
    stopAnimationTick()
  }

  watch((): string | null => cpmData.value?.textureUrl ?? null, (): void => {
    currentData = cpmData.value
    if (currentData) loadModel(currentData.textureUrl)
    else clearModel()
  }, { immediate: true })

  watch((): string => JSON.stringify(activeAnimations.value.map((entry) => entry.animation.id)), (): void => {
    const animations = activeAnimations.value
    player?.setAnimations(animations)
    options.onPlayingChanged?.(isAnimationPlaying.value && animations.length > 0)
  })

  watch(isAnimationPlaying, (playing: boolean) => {
    player?.setPlaying(playing)
    syncAnimationTick()
  })

  watch(animationSpeed, (speed: number) => {
    player?.setSpeed(speed)
  })

  watch(isAnimationLooped, (looped: boolean) => {
    player?.setForceLoop(looped)
  })

  watch(activeLayerIds, () => {
    updateVisibility()
  })

  onBeforeUnmount(() => {
    stopAnimationTick()
    clearModel()
  })

  return {}
}
