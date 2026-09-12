import type { Ref } from 'vue'
import type { TabKey } from '@/05-entities/core/types'

export type { TabKey }



export type SkinModelMode = 'classic' | 'slim'

export interface TabItem {
  key: TabKey
  icon: string
  label: string
  disabled?: boolean
}

export interface ViewerControls {
  minZoom: number
  zoomLevel: Ref<number>
  rotationY: Ref<number>
  rotationX: Ref<number>
  autoRotate: Ref<boolean>
  fitDistance: Ref<number>
  zoomIn: () => void
  zoomOut: () => void
  rotateLeft: () => void
  rotateRight: () => void
  rotateUp: () => void
  rotateDown: () => void
  resetZoom: () => void
  resetView: () => void
}

