import { describe, expect, it } from 'vitest'
import { nextTick, ref, shallowRef, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { withSetup } from '@/test-support/withSetup'
import { fitFovRadians, useViewerCamera } from '../useViewerCamera'
import type { ViewerControls } from '@/06-shared'

function createControls(): ViewerControls {
  return {
    minZoom: 5,
    zoomLevel: ref(22),
    rotationY: ref(0),
    rotationX: ref(0),
    autoRotate: ref(false),
    fitDistance: ref(22),
    zoomIn: (): void => {},
    zoomOut: (): void => {},
    rotateLeft: (): void => {},
    rotateRight: (): void => {},
    rotateUp: (): void => {},
    rotateDown: (): void => {},
    resetZoom: (): void => {},
    resetView: (): void => {},
  }
}

interface CameraHarness {
  camera: ShallowRef<THREE.PerspectiveCamera | null>
  model: ShallowRef<THREE.Group | null>
  controls: ViewerControls
  applyCamera: () => void
  setFitDistance: (distance: number) => void
  unmount: () => void
}

function mountCamera(): CameraHarness {
  const camera = shallowRef<THREE.PerspectiveCamera | null>(new THREE.PerspectiveCamera(35, 1))
  const model = shallowRef<THREE.Group | null>(null)
  const controls = createControls()

  const { result, unmount } = withSetup(() => useViewerCamera(
    { camera, getOrbitControls: (): null => null },
    model,
    controls,
  ))

  return {
    camera,
    model,
    controls,
    applyCamera: result.applyCamera,
    setFitDistance: result.setFitDistance,
    unmount,
  }
}

describe('fitFovRadians', () => {
  it('returns the smaller of vertical and horizontal fov', () => {
    const camera = new THREE.PerspectiveCamera(35, 1)
    expect(fitFovRadians(camera)).toBeCloseTo(35 * Math.PI / 180)

    camera.aspect = 2
    expect(fitFovRadians(camera)).toBeCloseTo(35 * Math.PI / 180)

    camera.aspect = 0.5
    const fovH = 2 * Math.atan(Math.tan(35 * Math.PI / 360) * 0.5)
    expect(fitFovRadians(camera)).toBeCloseTo(fovH)
  })

  it('falls back to the vertical fov for a non-finite or non-positive aspect', () => {
    const camera = new THREE.PerspectiveCamera(35, 0)
    expect(fitFovRadians(camera)).toBeCloseTo(35 * Math.PI / 180)

    camera.aspect = Number.NaN
    expect(fitFovRadians(camera)).toBeCloseTo(35 * Math.PI / 180)
  })
})

describe('useViewerCamera', () => {
  it('positions the camera from the zoom level and elevation on the YZ plane', () => {
    const harness = mountCamera()
    harness.controls.zoomLevel.value = 22
    harness.controls.rotationX.value = 30

    harness.applyCamera()

    const position = harness.camera.value?.position
    expect(position?.x).toBeCloseTo(0)
    expect(position?.y).toBeCloseTo(22 * Math.sin(Math.PI / 6))
    expect(position?.z).toBeCloseTo(22 * Math.cos(Math.PI / 6))
    harness.unmount()
  })

  it('keeps the camera azimuth gained from mouse orbit when zooming or tilting', () => {
    const harness = mountCamera()
    const camera = harness.camera.value
    if (!camera) throw new Error('camera was not created')
    camera.position.set(10, 5, 20)
    const azimuth = Math.atan2(10, 20)

    harness.controls.zoomLevel.value = 30
    harness.applyCamera()

    expect(Math.atan2(camera.position.x, camera.position.z)).toBeCloseTo(azimuth)
    expect(camera.position.length()).toBeCloseTo(30)

    harness.controls.rotationX.value = 45
    harness.applyCamera()

    expect(Math.atan2(camera.position.x, camera.position.z)).toBeCloseTo(azimuth)
    expect(camera.position.y).toBeCloseTo(30 * Math.sin(Math.PI / 4))
    harness.unmount()
  })

  it('applies rotationY to the model and re-applies it after the model is replaced', async () => {
    const harness = mountCamera()
    harness.controls.rotationY.value = 45

    const first = new THREE.Group()
    harness.model.value = first
    await nextTick()
    expect(first.rotation.y).toBeCloseTo(Math.PI / 4)

    harness.controls.rotationY.value = 90
    await nextTick()
    expect(first.rotation.y).toBeCloseTo(Math.PI / 2)

    const second = new THREE.Group()
    harness.model.value = second
    await nextTick()
    expect(second.rotation.y).toBeCloseTo(Math.PI / 2)
    harness.unmount()
  })

  it('setFitDistance writes zoom and fit distance and repositions the camera', () => {
    const harness = mountCamera()

    harness.setFitDistance(40)

    expect(harness.controls.zoomLevel.value).toBe(40)
    expect(harness.controls.fitDistance.value).toBe(40)
    const position = harness.camera.value?.position
    expect(position?.x).toBeCloseTo(0)
    expect(position?.z).toBeCloseTo(40)
    harness.unmount()
  })
})
