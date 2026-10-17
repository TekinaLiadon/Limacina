import { onScopeDispose, watch } from 'vue'
import * as THREE from 'three'
import type { CPMVec3 } from '@/05-entities'
import type { AnimatedNode, NodeIndex } from '../cpm-viewer/cpmAnimationPlayer'
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

interface FreeDrag {
  pointerId: number
  plane: THREE.Plane
  startPoint: THREE.Vector3
  parentInverse: THREE.Matrix4
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
  let freeDrag: FreeDrag | null = null

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

  function pickSelectedBone(event: PointerEvent): AnimatedNode | null {
    const storeId = editor.selectedBoneId.value
    const index = bridge.nodeIndex.value
    if (storeId === null || index === null) return null
    const node = index.get(storeId)
    if (!node) return null
    const meshes = node.meshes.filter((mesh): boolean => mesh.visible)
    if (meshes.length === 0) return null
    if (!setRayFromEvent(event)) return null
    const [hit] = raycaster.intersectObjects(meshes, false)
    return hit === undefined ? null : node
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

  function startFreeDrag(event: PointerEvent, node: AnimatedNode): void {
    const camera = bridge.camera.value
    const storeId = editor.selectedBoneId.value
    const { parent } = node.group
    if (camera === null || storeId === null || parent === null) return
    if (!setRayFromEvent(event)) return

    node.group.updateWorldMatrix(true, false)
    parent.updateWorldMatrix(true, false)
    const origin = node.group.getWorldPosition(new THREE.Vector3())
    const normal = camera.getWorldDirection(new THREE.Vector3()).normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
    const startPoint = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, startPoint) === null) return

    event.preventDefault()
    event.stopPropagation()
    editor.beginBoneDrag(storeId, editor.editFrame.value)
    freeDrag = {
      pointerId: event.pointerId,
      plane,
      startPoint,
      parentInverse: new THREE.Matrix4().copy(parent.matrixWorld).invert(),
    }
    window.addEventListener('pointermove', handleFreeMove, true)
    window.addEventListener('pointerup', handleFreeUp, true)
  }

  function handleFreeMove(event: PointerEvent): void {
    const session = freeDrag
    if (session === null || event.pointerId !== session.pointerId) return
    if (!setRayFromEvent(event)) return

    const point = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(session.plane, point) === null) return

    const worldDelta = point.sub(session.startPoint)
    const startLocal = session.startPoint.clone().applyMatrix4(session.parentInverse)
    const movedLocal = session.startPoint.clone().add(worldDelta).applyMatrix4(session.parentInverse)
    const localDelta = movedLocal.sub(startLocal)
    const poseDelta = poseDeltaFromLocalDelta({
      x: quantizeDragDelta(localDelta.x, DRAG_STEP),
      y: quantizeDragDelta(localDelta.y, DRAG_STEP),
      z: quantizeDragDelta(localDelta.z, DRAG_STEP),
    })
    editor.dragBoneTranslation(poseDelta.x, poseDelta.y, poseDelta.z)
  }

  function handleFreeUp(event: PointerEvent): void {
    if (freeDrag === null || event.pointerId !== freeDrag.pointerId) return
    freeDrag = null
    editor.endBoneDrag()
    window.removeEventListener('pointermove', handleFreeMove, true)
    window.removeEventListener('pointerup', handleFreeUp, true)
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
    if (!editor.isEditing.value) return

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
    ) return

    const node = index.get(storeId)
    const tipLocal = getTipLocal(storeId, index)
    if (!node || tipLocal === null) return

    const frameCount = editor.frameCount.value
    if (frameCount <= 0) return
    const duration = Math.max(animation.duration, 1)
    const currentFrame = editor.currentFrame.value

    player.setAnimations(editor.activeAnimations.value)

    const range = arcFrameRange(currentFrame, frameCount)
    const keySet = new Set(editor.selectedBoneKeys.value)
    const points: THREE.Vector3[] = []
    const keyPoints = new Map<number, THREE.Vector3>()

    for (const frame of arcSampleFrames(range)) {
      bridge.seekFrame(frame, frameCount, duration)
      const point = boneTipWorld(node, tipLocal)
      points.push(point)
      if (Number.isInteger(frame) && keySet.has(frame)) keyPoints.set(frame, point.clone())
    }

    for (const ghost of ghostFrames(currentFrame, editor.ghostBefore.value, editor.ghostAfter.value, frameCount)) {
      buildGhost(model, ghost.frame, ghost.offset, frameCount, duration)
    }

    bridge.seekFrame(currentFrame, frameCount, duration)

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
      return
    }
    if (editor.isPlaying.value) return
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
      return
    }

    const node = pickSelectedBone(event)
    if (node !== null) startFreeDrag(event, node)
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
    if (freeDrag !== null) {
      freeDrag = null
      editor.endBoneDrag()
    }
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerUp, true)
    window.removeEventListener('pointermove', handleFreeMove, true)
    window.removeEventListener('pointerup', handleFreeUp, true)
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
    if (!playing) scheduleRebuild()
  })
  watch(() => editor.isEditing.value, (editing: boolean): void => {
    if (editing) scheduleRebuild()
    else {
      resetDrag()
      clearScene()
    }
  })

  scheduleRebuild()

  onScopeDispose((): void => {
    cancelRebuild()
    resetDrag()
    detachContainer()
    clearScene()
    overlay?.removeFromParent()
    overlay = null
    markerGeometry.dispose()
    markerMaterial.dispose()
    tipCache.clear()
  })
}
