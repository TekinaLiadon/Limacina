import { inject, provide, ref, type InjectionKey } from 'vue'
import type { ViewerControls } from '@/06-shared'

const VIEWER_CONTROLS_KEY: InjectionKey<ViewerControls> = Symbol('viewer-controls')

const ROTATE_STEP = 45
const ELEVATION_STEP = 15
export const ELEVATION_MIN = -22.5
export const ELEVATION_MAX = 45
const DEFAULT_ELEVATION = 13
const ZOOM_STEP_FACTOR = 1.25
export const MIN_ZOOM_PERCENT = 10

function createViewerControls(getMinZoom: () => number): ViewerControls {
  const zoomLevel = ref<number>(22)
  const rotationY = ref<number>(0)
  const rotationX = ref<number>(DEFAULT_ELEVATION)
  const autoRotate = ref<boolean>(false)
  const fitDistance = ref<number>(22)

  return {
    get minZoom(): number {
      return getMinZoom()
    },
    zoomLevel,
    rotationY,
    rotationX,
    autoRotate,
    fitDistance,
    zoomIn: (): void => {
      zoomLevel.value = Math.max(getMinZoom(), zoomLevel.value / ZOOM_STEP_FACTOR)
    },
    zoomOut: (): void => {
      const maxDistance = fitDistance.value * (100 / MIN_ZOOM_PERCENT)
      zoomLevel.value = Math.min(maxDistance, zoomLevel.value * ZOOM_STEP_FACTOR)
    },
    rotateLeft: (): void => {
      rotationY.value = (((rotationY.value - ROTATE_STEP) % 360) + 360) % 360
    },
    rotateRight: (): void => {
      rotationY.value = (rotationY.value + ROTATE_STEP) % 360
    },
    rotateUp: (): void => {
      rotationX.value = Math.min(ELEVATION_MAX, rotationX.value + ELEVATION_STEP)
    },
    rotateDown: (): void => {
      rotationX.value = Math.max(ELEVATION_MIN, rotationX.value - ELEVATION_STEP)
    },
    resetZoom: (): void => {
      zoomLevel.value = fitDistance.value
    },
    resetView: (): void => {
      zoomLevel.value = fitDistance.value
      rotationY.value = 0
      rotationX.value = DEFAULT_ELEVATION
    },
  }
}

export function provideViewerControls(getMinZoom: () => number): ViewerControls {
  const controls = createViewerControls(getMinZoom)
  provide(VIEWER_CONTROLS_KEY, controls)
  return controls
}

export function useViewerControls(): ViewerControls {
  return inject(VIEWER_CONTROLS_KEY, () => createViewerControls(() => 5), true)
}
