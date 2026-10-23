import { shallowRef, type ShallowRef } from 'vue'
import type * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CpmAnimationPlayer, NodeIndex } from './cpmAnimationPlayer'

export interface CpmEditorBridge {
  modelGroup: ShallowRef<THREE.Group | null>
  nodeIndex: ShallowRef<NodeIndex | null>
  player: ShallowRef<CpmAnimationPlayer | null>
  camera: ShallowRef<THREE.PerspectiveCamera | null>
  container: ShallowRef<HTMLDivElement | null>
  orbitControls: ShallowRef<OrbitControls | null>
  isGizmoDragging: ShallowRef<boolean>
  hiddenBoneIds: ShallowRef<ReadonlySet<number>>
  seekFrame: (frame: number, frameCount: number, durationMs: number) => void
  seekTime: (elapsedMs: number) => void
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

  const seekTime = (elapsedMs: number): void => {
    const current = player.value
    if (!current || !Number.isFinite(elapsedMs)) return
    current.seek(Math.max(0, elapsedMs))
    current.applyCurrentFrame()
  }

  return {
    modelGroup: shallowRef<THREE.Group | null>(null),
    nodeIndex: shallowRef<NodeIndex | null>(null),
    player,
    camera: shallowRef<THREE.PerspectiveCamera | null>(null),
    container: shallowRef<HTMLDivElement | null>(null),
    orbitControls: shallowRef<OrbitControls | null>(null),
    isGizmoDragging: shallowRef<boolean>(false),
    hiddenBoneIds: shallowRef<ReadonlySet<number>>(new Set<number>()),
    seekFrame,
    seekTime,
    requestRender: (): void => player.value?.applyCurrentFrame(),
  }
}
