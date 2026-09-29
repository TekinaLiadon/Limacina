import { watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { ViewerControls } from '@/06-shared'

interface AutoRotatableControls {
  autoRotate: boolean
}

interface ViewerCameraScene {
  camera: Ref<THREE.PerspectiveCamera | null>
  getOrbitControls: () => AutoRotatableControls | null
}

export function fitFovRadians(camera: THREE.PerspectiveCamera): number {
  const fovV = camera.fov * (Math.PI / 180)
  const { aspect } = camera
  if (!Number.isFinite(aspect) || aspect <= 0) return fovV
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect)
  return Number.isFinite(fovH) && fovH > 0 ? Math.min(fovV, fovH) : fovV
}

export function useViewerCamera(
    scene: ViewerCameraScene,
    model: Ref<THREE.Group | null>,
    controls: ViewerControls,
) {
  function applyCamera(): void {
    if (!scene.camera.value) return

    const dist = controls.zoomLevel.value
    const elevation = THREE.MathUtils.degToRad(controls.rotationX.value)
    scene.camera.value.position.set(0, dist * Math.sin(elevation), dist * Math.cos(elevation))
    scene.camera.value.lookAt(0, 0, 0)
  }

  function setFitDistance(distance: number): void {
    controls.zoomLevel.value = distance
    controls.fitDistance.value = distance
    applyCamera()
  }

  function modelBoundingSphereRadius(): number | null {
    const group = model.value
    if (!group) return null

    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    return Math.sqrt((size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2)
  }

  watch(controls.autoRotate, (enabled: boolean) => {
    const orbit = scene.getOrbitControls()
    if (orbit) orbit.autoRotate = enabled
  })

  watch(controls.zoomLevel, () => {
    applyCamera()
  })

  watch(controls.rotationX, () => {
    applyCamera()
  })

  watch(controls.rotationY, (angle: number) => {
    if (model.value) {
      model.value.rotation.y = THREE.MathUtils.degToRad(angle)
    }
  })

  return { applyCamera, setFitDistance, modelBoundingSphereRadius }
}
