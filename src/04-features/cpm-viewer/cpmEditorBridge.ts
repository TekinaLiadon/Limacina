import { shallowRef, type ShallowRef } from 'vue'
import type * as THREE from 'three'
import type { CpmAnimationPlayer, NodeIndex } from './cpmAnimationPlayer'

export interface CpmEditorBridge {
  modelGroup: ShallowRef<THREE.Group | null>
  nodeIndex: ShallowRef<NodeIndex | null>
  player: ShallowRef<CpmAnimationPlayer | null>
  camera: ShallowRef<THREE.PerspectiveCamera | null>
  container: ShallowRef<HTMLDivElement | null>
  seekFrame: (frame: number, frameCount: number, durationMs: number) => void
  requestRender: () => void
}

export function createCpmEditorBridge(): CpmEditorBridge {
  const player = shallowRef<CpmAnimationPlayer | null>(null)

  const seekFrame = (frame: number, frameCount: number, durationMs: number): void => {
    const current = player.value
    if (!current) return
    const safeFrameCount = Math.max(1, frameCount)
    const safeDuration = Math.max(1, durationMs)
    const clamped = Math.min(Math.max(frame, 0), safeFrameCount - 1)
    current.seek((clamped / safeFrameCount) * safeDuration)
    current.applyCurrentFrame()
  }

  return {
    modelGroup: shallowRef<THREE.Group | null>(null),
    nodeIndex: shallowRef<NodeIndex | null>(null),
    player,
    camera: shallowRef<THREE.PerspectiveCamera | null>(null),
    container: shallowRef<HTMLDivElement | null>(null),
    seekFrame,
    requestRender: (): void => player.value?.applyCurrentFrame(),
  }
}
