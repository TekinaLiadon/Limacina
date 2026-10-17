import { onScopeDispose, watch } from 'vue'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { CPMVec3 } from '@/05-entities'
import type { NodeIndex } from '../cpm-viewer/cpmAnimationPlayer'
import type { CpmEditorBridge } from '../cpm-viewer/cpmEditorBridge'
import type { CpmAnimationEditorApi } from './useCpmAnimationEditor'
import {
  ARC_DRAG_DEGREES_PER_PIXEL,
  arcFrameRange,
  arcSampleFrames,
  boneTipWorld,
  computeBoneTipLocal,
  ghostFrames,
  markerRadiusFor,
} from './editorArc'
import { pivotRotationOffset } from './editorRotation'
import {
  DRAG_STEP,
  poseDeltaFromLocalDelta,
  quantizeDragDelta,
} from './editorDrag'

const ARC_COLOR = 0x3b82f6
const KEY_MARKER_COLOR = 0xf59e0b
const PAST_GHOST_COLOR = 0x3b82f6
const FUTURE_GHOST_COLOR = 0xf59e0b
const GHOST_OPACITY = 0.22
const GHOST_MIN_OPACITY = 0.08
const GIZMO_HELPER_NAME = 'cpm-editor-gizmo'
const GIZMO_TARGET_NAME = 'cpm-editor-gizmo-target'

interface GhostNode {
  group: THREE.Group
  material: THREE.MeshBasicMaterial
}

interface MarkerPivot {
  pivotLocal: THREE.Vector3
  pivotScale: THREE.Vector3
  startQuaternion: THREE.Quaternion
  baseRotation: THREE.Euler
  additive: boolean
  startRotation: CPMVec3
}

interface MarkerDrag {
  pointerId: number
  startX: number
  startY: number
  pivot: MarkerPivot | null
}

export function useCpmEditorScene(
  editor: CpmAnimationEditorApi,
  bridge: CpmEditorBridge,
): void {
  const markerGeometry = new THREE.SphereGeometry(1, 12, 8)
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: KEY_MARKER_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  })
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const markers: THREE.Mesh[] = []
  const ghosts: GhostNode[] = []
  let overlay: THREE.Group | null = null
  let arcLine: THREE.Line | null = null
  let tipCache = new Map<number, THREE.Vector3>()
  let rebuildId = 0
  let pointerContainer: HTMLDivElement | null = null
  let drag: MarkerDrag | null = null
  let gizmo: TransformControls | null = null
  let gizmoTarget: THREE.Object3D | null = null
  const gizmoStart = new THREE.Vector3()
  let isGizmoDragging = false

  function ensureOverlay(): THREE.Group | null {
    const scene = bridge.modelGroup.value?.parent ?? null
    if (scene === null) return null
    if (overlay === null) {
      overlay = new THREE.Group()
      overlay.name = 'cpm-editor-overlay'
    }
    if (overlay.parent !== scene) scene.add(overlay)
    return overlay
  }

  function setRayFromEvent(event: PointerEvent): boolean {
    const container = bridge.container.value
    const camera = bridge.camera.value
    if (container === null || camera === null) return false
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false

    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    return true
  }

  function buildMarkerPivot(storeId: number, index: NodeIndex): MarkerPivot | null {
    const node = index.get(storeId)
    const pose = editor.selectedBonePose.value
    const tipLocal = getTipLocal(storeId, index)
    if (!node || pose === null || tipLocal === null) return null
    node.group.updateWorldMatrix(true, false)
    return {
      pivotLocal: tipLocal.clone(),
      pivotScale: node.group.scale.clone(),
      startQuaternion: node.group.quaternion.clone(),
      baseRotation: node.baseRot.clone(),
      additive: editor.animation.value?.additive ?? false,
      startRotation: { ...pose.rotation },
    }
  }

  function ensureGizmo(): TransformControls | null {
    const camera = bridge.camera.value
    const container = bridge.container.value
    const scene = bridge.modelGroup.value?.parent ?? null
    if (camera === null || container === null || scene === null) return null

    if (gizmo === null) {
      gizmo = new TransformControls(camera, container)
      gizmo.setMode('translate')
      gizmo.setSpace('local')
      gizmo.setTranslationSnap(DRAG_STEP)
      gizmo.setSize(0.9)
      gizmo.addEventListener('dragging-changed', handleGizmoDraggingChanged)
      gizmo.addEventListener('objectChange', handleGizmoChange)
      gizmo.getHelper().name = GIZMO_HELPER_NAME
    }
    const helper = gizmo.getHelper()
    if (helper.parent !== scene) scene.add(helper)
    return gizmo
  }

  function detachGizmo(): void {
    if (isGizmoDragging) {
      isGizmoDragging = false
      bridge.isGizmoDragging.value = false
      editor.endBoneDrag()
      const orbit = bridge.orbitControls.value
      if (orbit !== null) orbit.enabled = true
    }
    if (gizmo !== null && gizmo.dragging) gizmo.dragging = false
    gizmo?.detach()
    if (gizmoTarget === null) return
    gizmoTarget.removeFromParent()
    gizmoTarget = null
  }

  function syncGizmo(storeId: number, index: NodeIndex): void {
    const controls = ensureGizmo()
    const node = index.get(storeId)
    const parent = node?.group.parent ?? null
    if (controls === null || node === undefined || parent === null) {
      detachGizmo()
      return
    }
    if (isGizmoDragging) return

    if (gizmoTarget === null) {
      gizmoTarget = new THREE.Object3D()
      gizmoTarget.name = GIZMO_TARGET_NAME
    }
    if (gizmoTarget.parent !== parent) parent.add(gizmoTarget)
    gizmoTarget.position.copy(node.group.position)
    gizmoTarget.quaternion.identity()
    gizmoTarget.scale.set(1, 1, 1)
    controls.attach(gizmoTarget)
  }

  function handleGizmoDraggingChanged(event: { value: unknown }): void {
    const orbit = bridge.orbitControls.value
    const dragging = event.value === true
    if (!dragging) {
      isGizmoDragging = false
      bridge.isGizmoDragging.value = false
      editor.endBoneDrag()
      if (orbit !== null) orbit.enabled = true
      scheduleRebuild()
      return
    }

    const storeId = editor.selectedBoneId.value
    if (storeId === null || gizmoTarget === null) return
    isGizmoDragging = true
    bridge.isGizmoDragging.value = true
    gizmoStart.copy(gizmoTarget.position)
    if (orbit !== null) orbit.enabled = false
    editor.beginBoneDrag(storeId, editor.editFrame.value)
  }

  function handleGizmoChange(): void {
    if (!isGizmoDragging || gizmoTarget === null) return
    const delta = {
      x: quantizeDragDelta(gizmoTarget.position.x - gizmoStart.x, DRAG_STEP),
      y: quantizeDragDelta(gizmoTarget.position.y - gizmoStart.y, DRAG_STEP),
      z: quantizeDragDelta(gizmoTarget.position.z - gizmoStart.z, DRAG_STEP),
    }
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return
    const poseDelta = poseDeltaFromLocalDelta(delta)
    editor.dragBoneTranslation(poseDelta.x, poseDelta.y, poseDelta.z)
  }

  function disposeArcLine(): void {
    if (arcLine === null) return
    arcLine.removeFromParent()
    arcLine.geometry.dispose()
    const {material} = arcLine
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
    arcLine = null
  }

  function clearMarkers(): void {
    markers.forEach((marker) => marker.removeFromParent())
    markers.length = 0
  }

  function clearGhosts(): void {
    ghosts.forEach((ghost) => {
      ghost.group.removeFromParent()
      ghost.material.dispose()
    })
    ghosts.length = 0
  }

  function clearScene(): void {
    disposeArcLine()
    clearMarkers()
    clearGhosts()
  }

  function getTipLocal(storeId: number, index: NodeIndex): THREE.Vector3 | null {
    const node = index.get(storeId)
    if (!node) return null
    const cached = tipCache.get(storeId)
    if (cached !== undefined) return cached
    const tip = computeBoneTipLocal(node, index)
    tipCache.set(storeId, tip)
    return tip
  }

  function buildGhost(
    model: THREE.Group,
    frame: number,
    offset: number,
    frameCount: number,
    duration: number,
  ): void {
    bridge.seekFrame(frame, frameCount, duration)
    const group = model.clone(true)
    const material = new THREE.MeshBasicMaterial({
      color: offset < 0 ? PAST_GHOST_COLOR : FUTURE_GHOST_COLOR,
      transparent: true,
      opacity: Math.max(GHOST_MIN_OPACITY, GHOST_OPACITY / Math.abs(offset)),
      depthWrite: false,
    })
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = material
        object.renderOrder = 1
      }
    })
    const overlayGroup = ensureOverlay()
    if (overlayGroup === null) {
      material.dispose()
      return
    }
    overlayGroup.add(group)
    ghosts.push({ group, material })
  }

  function rebuild(): void {
    rebuildId = 0
    clearScene()
    if (!editor.isEditing.value || editor.isPlaying.value) {
      detachGizmo()
      return
    }

    const overlayGroup = ensureOverlay()
    const model = bridge.modelGroup.value
    const index = bridge.nodeIndex.value
    const player = bridge.player.value
    const animation = editor.animation.value
    const storeId = editor.selectedBoneId.value
    if (
      overlayGroup === null
      || model === null
      || index === null
      || player === null
      || animation === null
      || storeId === null
    ) {
      detachGizmo()
      return
    }

    const node = index.get(storeId)
    if (!node) {
      detachGizmo()
      return
    }
    const tipLocal = getTipLocal(storeId, index)

    const frameCount = editor.frameCount.value
    if (frameCount <= 0) {
      detachGizmo()
      return
    }
    const duration = Math.max(animation.duration, 1)
    const currentFrame = editor.currentFrame.value

    player.setAnimations(editor.activeAnimations.value)

    const range = arcFrameRange(currentFrame, frameCount)
    const keySet = new Set(editor.selectedBoneKeys.value)
    const points: THREE.Vector3[] = []
    const keyPoints = new Map<number, THREE.Vector3>()

    if (tipLocal !== null) {
      for (const frame of arcSampleFrames(range)) {
        bridge.seekFrame(frame, frameCount, duration)
        const point = boneTipWorld(node, tipLocal)
        points.push(point)
        if (Number.isInteger(frame) && keySet.has(frame)) keyPoints.set(frame, point.clone())
      }
    }

    for (const ghost of ghostFrames(currentFrame, editor.ghostBefore.value, editor.ghostAfter.value, frameCount)) {
      buildGhost(model, ghost.frame, ghost.offset, frameCount, duration)
    }

    bridge.seekFrame(currentFrame, frameCount, duration)
    syncGizmo(storeId, index)

    if (tipLocal === null) return

    if (points.length >= 2) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = new THREE.LineBasicMaterial({
        color: ARC_COLOR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      })
      arcLine = new THREE.Line(geometry, material)
      arcLine.renderOrder = 2
      overlayGroup.add(arcLine)
    }

    const radius = markerRadiusFor(model)
    keyPoints.forEach((point, frame) => {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial)
      marker.position.copy(point)
      marker.scale.setScalar(radius)
      marker.userData.keyFrame = frame
      marker.renderOrder = 3
      overlayGroup.add(marker)
      markers.push(marker)
    })
  }

  function cancelRebuild(): void {
    if (rebuildId === 0) return
    cancelAnimationFrame(rebuildId)
    rebuildId = 0
  }

  function scheduleRebuild(): void {
    if (!editor.isEditing.value) {
      cancelRebuild()
      clearScene()
      detachGizmo()
      return
    }
    if (editor.isPlaying.value) {
      detachGizmo()
      return
    }
    if (rebuildId !== 0) return
    rebuildId = requestAnimationFrame(rebuild)
  }

  function pickMarker(event: PointerEvent): THREE.Mesh | null {
    if (markers.length === 0) return null
    if (!setRayFromEvent(event)) return null
    const [hit] = raycaster.intersectObjects(markers, false)
    return hit !== undefined && hit.object instanceof THREE.Mesh ? hit.object : null
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!editor.isEditing.value || event.button !== 0) return

    const marker = pickMarker(event)
    if (marker !== null) {
      const frame = marker.userData.keyFrame
      const storeId = editor.selectedBoneId.value
      if (typeof frame !== 'number' || storeId === null) return

      event.preventDefault()
      event.stopPropagation()
      editor.beginBoneDrag(storeId, frame)
      const index = bridge.nodeIndex.value
      const pivot = editor.rotationPivot.value === 'tip' && index !== null
        ? buildMarkerPivot(storeId, index)
        : null
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, pivot }
      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('pointerup', handlePointerUp, true)
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return
    const yaw = (event.clientX - drag.startX) * ARC_DRAG_DEGREES_PER_PIXEL
    const pitch = -(event.clientY - drag.startY) * ARC_DRAG_DEGREES_PER_PIXEL
    if (drag.pivot !== null) {
      const offset = pivotRotationOffset({
        ...drag.pivot,
        deltaYaw: yaw,
        deltaPitch: pitch,
      })
      editor.dragBoneRotation(yaw, pitch, offset)
      return
    }
    editor.dragBoneRotation(yaw, pitch)
  }

  function handlePointerUp(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return
    drag = null
    editor.endBoneDrag()
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerUp, true)
  }

  function resetDrag(): void {
    if (drag !== null) {
      drag = null
      editor.endBoneDrag()
    }
    if (isGizmoDragging) {
      isGizmoDragging = false
      bridge.isGizmoDragging.value = false
      editor.endBoneDrag()
    }
    const orbit = bridge.orbitControls.value
    if (orbit !== null) orbit.enabled = true
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerUp, true)
  }

  function detachContainer(): void {
    if (pointerContainer === null) return
    pointerContainer.removeEventListener('pointerdown', handlePointerDown, true)
    pointerContainer = null
  }

  function attachContainer(container: HTMLDivElement | null): void {
    detachContainer()
    if (container === null) return
    container.addEventListener('pointerdown', handlePointerDown, true)
    pointerContainer = container
  }

  watch(() => bridge.container.value, attachContainer, { immediate: true })
  watch(() => bridge.modelGroup.value, (): void => {
    tipCache = new Map()
    scheduleRebuild()
  })
  watch(() => bridge.nodeIndex.value, (): void => {
    tipCache = new Map()
    scheduleRebuild()
  })
  watch(() => editor.selectedBoneId.value, scheduleRebuild)
  watch(() => editor.currentFrame.value, scheduleRebuild)
  watch(() => editor.animation.value, scheduleRebuild)
  watch(() => editor.ghostBefore.value, scheduleRebuild)
  watch(() => editor.ghostAfter.value, scheduleRebuild)
  watch(() => editor.isPlaying.value, (playing: boolean): void => {
    if (playing) detachGizmo()
    else scheduleRebuild()
  })
  watch(() => editor.isEditing.value, (editing: boolean): void => {
    if (editing) scheduleRebuild()
    else {
      resetDrag()
      detachGizmo()
      clearScene()
    }
  })

  scheduleRebuild()

  onScopeDispose((): void => {
    cancelRebuild()
    resetDrag()
    detachContainer()
    clearScene()
    if (gizmo !== null) {
      gizmo.removeEventListener('dragging-changed', handleGizmoDraggingChanged)
      gizmo.removeEventListener('objectChange', handleGizmoChange)
      gizmo.detach()
      gizmo.getHelper().removeFromParent()
      gizmo.dispose()
      gizmo = null
    }
    if (gizmoTarget !== null) {
      gizmoTarget.removeFromParent()
      gizmoTarget = null
    }
    overlay?.removeFromParent()
    overlay = null
    markerGeometry.dispose()
    markerMaterial.dispose()
    tipCache.clear()
  })
}
