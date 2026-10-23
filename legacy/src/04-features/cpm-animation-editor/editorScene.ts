import { onScopeDispose, watch } from 'vue'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { NodeIndex } from '../cpm-viewer/cpmAnimationPlayer'
import type { CpmEditorBridge } from '../cpm-viewer/cpmEditorBridge'
import type { CpmAnimationEditorApi } from './useCpmAnimationEditor'
import {
  arcFrameRange,
  arcSampleFrames,
  boneTipWorld,
  computeBoneTipLocal,
  ghostFrames,
} from './editorArc'
import {
  DRAG_STEP,
  poseDeltaFromLocalDelta,
  quantizeDragDelta,
} from './editorDrag'

const ARC_COLOR = 0x3b82f6
const PAST_GHOST_COLOR = 0x3b82f6
const FUTURE_GHOST_COLOR = 0xf59e0b
const GHOST_OPACITY = 0.22
const GHOST_MIN_OPACITY = 0.08
const GIZMO_HELPER_NAME = 'cpm-editor-gizmo'
const GIZMO_TARGET_NAME = 'cpm-editor-gizmo-target'
const GIZMO_SIZE = 0.9
const GIZMO_Y_SHAFT_SCALE = 0.6
const GIZMO_Y_HANDLE_MIN = 0.45
const GIZMO_Y_HANDLE_MAX = 0.62
const GIZMO_AXIS_Y_COLOR = 0x00ff00
const ROTATION_HANDLES_NAME = 'cpm-editor-rotation-handles'
const ROTATION_HANDLE_GROUP_PREFIX = 'cpm-editor-rotation-handle-'
const ROTATION_HANDLE_HEAD_PREFIX = 'cpm-editor-rotation-head-'
const ROTATION_HANDLE_RADII: Record<EditorAxis, number> = { x: 0.11, y: 0.13, z: 0.15 }
const ROTATION_HANDLE_TUBE = 0.014
const ROTATION_HANDLE_PICKER_TUBE = 0.06
const ROTATION_HANDLE_ARC = Math.PI * 0.9
const ROTATION_HANDLE_HEAD_RADIUS = 0.034
const ROTATION_HANDLE_HEAD_HEIGHT = 0.09
const ROTATION_DRAG_DEGREES_PER_PIXEL = 0.5
const ROTATION_HANDLE_HOVER_COLOR = 0xffff00
const ROTATION_HANDLE_START: Record<EditorAxis, number> = {
  x: Math.PI * 0.2,
  y: Math.PI * 0.7,
  z: Math.PI * 0.2,
}
const ROTATION_HANDLE_COLOR: Record<EditorAxis, number> = {
  x: 0xff0000,
  y: 0x00ff00,
  z: 0x0000ff,
}
const ROTATION_POSE_SIGN: Record<EditorAxis, number> = { x: 1, y: -1, z: -1 }
const ROTATION_AXES: EditorAxis[] = ['x', 'y', 'z']

type EditorAxis = 'x' | 'y' | 'z'

interface GhostNode {
  group: THREE.Group
  material: THREE.MeshBasicMaterial
}

interface RotationDrag {
  axis: EditorAxis
  pointerId: number
  startX: number
  startY: number
  tangent: THREE.Vector2
}

export function useCpmEditorScene(
  editor: CpmAnimationEditorApi,
  bridge: CpmEditorBridge,
): void {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const ghosts: GhostNode[] = []
  let overlay: THREE.Group | null = null
  let arcLine: THREE.Line | null = null
  let tipCache = new Map<number, THREE.Vector3>()
  let rebuildId = 0
  let pointerContainer: HTMLDivElement | null = null
  let rotationDrag: RotationDrag | null = null
  let rotationHandles: THREE.Group | null = null
  const rotationPickers: THREE.Mesh[] = []
  const rotationHandleMaterials = new Map<EditorAxis, THREE.MeshBasicMaterial>()
  let hoveredRotationAxis: EditorAxis | null = null
  let gizmo: TransformControls | null = null
  let gizmoTarget: THREE.Object3D | null = null
  const gizmoStart = new THREE.Vector3()
  const handleWorldPosition = new THREE.Vector3()
  const handleWorldQuaternion = new THREE.Quaternion()
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

  function axisVector(axis: EditorAxis): THREE.Vector3 {
    return new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
  }

  function createRotationHandle(axis: EditorAxis): THREE.Group {
    const group = new THREE.Group()
    group.name = `${ROTATION_HANDLE_GROUP_PREFIX}${axis}`
    const material = new THREE.MeshBasicMaterial({
      color: ROTATION_HANDLE_COLOR[axis],
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    rotationHandleMaterials.set(axis, material)
    const startAngle = ROTATION_HANDLE_START[axis]
    const radius = ROTATION_HANDLE_RADII[axis]
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(
        radius,
        ROTATION_HANDLE_TUBE,
        6,
        32,
        ROTATION_HANDLE_ARC,
      ),
      material,
    )
    arc.rotation.z = startAngle
    arc.renderOrder = 4
    group.add(arc)

    const headAngle = startAngle + ROTATION_HANDLE_ARC
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(ROTATION_HANDLE_HEAD_RADIUS, ROTATION_HANDLE_HEAD_HEIGHT, 12),
      material,
    )
    head.name = `${ROTATION_HANDLE_HEAD_PREFIX}${axis}`
    head.position.set(
      radius * Math.cos(headAngle),
      radius * Math.sin(headAngle),
      0,
    )
    head.rotation.z = headAngle
    head.renderOrder = 4
    group.add(head)

    const picker = new THREE.Mesh(
      new THREE.TorusGeometry(
        radius,
        ROTATION_HANDLE_PICKER_TUBE,
        4,
        24,
      ),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    )
    picker.userData.rotationAxis = axis
    picker.renderOrder = 4
    group.add(picker)
    rotationPickers.push(picker)

    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVector(axis))
    return group
  }

  function updateRotationHandles(): void {
    const group = rotationHandles
    const target = gizmoTarget
    const camera = bridge.camera.value
    if (group === null) return
    if (!group.visible || target === null || target.parent === null || camera === null) return

    target.getWorldPosition(handleWorldPosition)
    target.parent.getWorldQuaternion(handleWorldQuaternion)
    const distance = handleWorldPosition.distanceTo(camera.position)
    const factor = distance * Math.min(1.9 * Math.tan(Math.PI * camera.fov / 360) / camera.zoom, 7)
    group.position.copy(handleWorldPosition)
    group.quaternion.copy(handleWorldQuaternion)
    group.scale.setScalar(factor * GIZMO_SIZE / 4)
  }

  function ensureRotationHandles(): THREE.Group | null {
    const scene = bridge.modelGroup.value?.parent ?? null
    if (scene === null) return null
    if (rotationHandles === null) {
      const handles = new THREE.Group()
      handles.name = ROTATION_HANDLES_NAME
      handles.visible = false
      for (const axis of ROTATION_AXES) handles.add(createRotationHandle(axis))
      handles.updateMatrixWorld = (force?: boolean): void => {
        updateRotationHandles()
        THREE.Group.prototype.updateMatrixWorld.call(handles, force)
      }
      rotationHandles = handles
    }
    if (rotationHandles.parent !== scene) scene.add(rotationHandles)
    return rotationHandles
  }

  function setRotationHandlesVisible(visible: boolean): void {
    if (rotationHandles === null) return
    rotationHandles.visible = visible
  }

  function setRotationHandleHover(axis: EditorAxis | null): void {
    if (hoveredRotationAxis === axis) return
    hoveredRotationAxis = axis
    for (const [handleAxis, material] of rotationHandleMaterials) {
      material.color.setHex(
        handleAxis === axis ? ROTATION_HANDLE_HOVER_COLOR : ROTATION_HANDLE_COLOR[handleAxis],
      )
    }
  }

  function shortenGizmoYAxis(controls: TransformControls): void {
    const shift = 0.5 * (1 - GIZMO_Y_SHAFT_SCALE)
    controls.getHelper().traverse((object): void => {
      if (!(object instanceof THREE.Mesh) || object.name !== 'Y') return
      if (!(object.material instanceof THREE.MeshBasicMaterial)) return
      if (object.material.color.getHex() !== GIZMO_AXIS_Y_COLOR) return
      object.geometry.computeBoundingBox()
      const box = object.geometry.boundingBox
      if (box === null) return
      if (Math.abs(box.min.y) < 0.001 && Math.abs(box.max.y - 0.5) < 0.001) {
        object.geometry.scale(1, GIZMO_Y_SHAFT_SCALE, 1)
      }
      if (box.min.y >= GIZMO_Y_HANDLE_MIN && box.max.y <= GIZMO_Y_HANDLE_MAX) {
        object.geometry.translate(0, -shift, 0)
      }
      object.geometry.computeBoundingBox()
    })
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
      gizmo.setSize(GIZMO_SIZE)
      gizmo.addEventListener('dragging-changed', handleGizmoDraggingChanged)
      gizmo.addEventListener('objectChange', handleGizmoChange)
      gizmo.getHelper().name = GIZMO_HELPER_NAME
      shortenGizmoYAxis(gizmo)
    }
    const helper = gizmo.getHelper()
    if (helper.parent !== scene) scene.add(helper)
    return gizmo
  }

  function detachGizmo(): void {
    setRotationHandlesVisible(false)
    setRotationHandleHover(null)
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
    setRotationHandlesVisible(true)
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

    beginGizmoDrag()
  }

  function beginGizmoDrag(): boolean {
    if (gizmoTarget === null) return false
    const storeId = editor.selectedBoneId.value
    const node = storeId === null ? undefined : bridge.nodeIndex.value?.get(storeId)
    if (storeId === null || node === undefined) return false

    isGizmoDragging = true
    bridge.isGizmoDragging.value = true
    gizmoStart.copy(node.group.position)
    const orbit = bridge.orbitControls.value
    if (orbit !== null) orbit.enabled = false
    editor.beginBoneDrag(storeId, editor.editFrame.value)
    return true
  }

  function handleGizmoChange(): void {
    if (gizmoTarget === null) return
    if (!isGizmoDragging) {
      if (gizmo?.dragging !== true) return
      if (!beginGizmoDrag()) return
    }
    const delta = {
      x: quantizeDragDelta(gizmoTarget.position.x - gizmoStart.x, DRAG_STEP),
      y: quantizeDragDelta(gizmoTarget.position.y - gizmoStart.y, DRAG_STEP),
      z: quantizeDragDelta(gizmoTarget.position.z - gizmoStart.z, DRAG_STEP),
    }
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return
    const poseDelta = poseDeltaFromLocalDelta(delta)
    editor.dragBoneTranslation(poseDelta.x, poseDelta.y, poseDelta.z)
    scheduleRebuild()
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

  function clearGhosts(): void {
    ghosts.forEach((ghost) => {
      ghost.group.removeFromParent()
      ghost.material.dispose()
    })
    ghosts.length = 0
  }

  function clearScene(): void {
    disposeArcLine()
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
    if (!editor.isEditing.value || editor.isPlaying.value || editor.isScrubbing.value) {
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

    ensureRotationHandles()
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
    const points: THREE.Vector3[] = []

    if (tipLocal !== null) {
      for (const frame of arcSampleFrames(range)) {
        bridge.seekFrame(frame, frameCount, duration)
        points.push(boneTipWorld(node, tipLocal))
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

  function pickRotationHandle(event: PointerEvent): EditorAxis | null {
    if (rotationHandles === null || !rotationHandles.visible) return null
    if (!setRayFromEvent(event)) return null
    const [hit] = raycaster.intersectObjects(rotationPickers, false)
    if (hit === undefined) return null
    const axis = hit.object.userData.rotationAxis
    return axis === 'x' || axis === 'y' || axis === 'z' ? axis : null
  }

  function handlePointerHover(event: PointerEvent): void {
    if (rotationDrag !== null) {
      event.stopImmediatePropagation()
      return
    }
    if (!editor.isEditing.value || isGizmoDragging || event.buttons !== 0) return

    const axis = pickRotationHandle(event)
    if (axis !== null) {
      event.stopImmediatePropagation()
      if (gizmo !== null && !gizmo.dragging) gizmo.axis = null
    }
    setRotationHandleHover(axis)
  }

  function handlePointerLeave(): void {
    if (rotationDrag !== null) return
    setRotationHandleHover(null)
  }

  function worldAxisFor(axis: EditorAxis): THREE.Vector3 {
    const vector = axisVector(axis)
    const parent = gizmoTarget?.parent
    if (parent === null || parent === undefined) return vector
    return vector.applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()))
  }

  function screenTangent(
    axis: EditorAxis,
    origin: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
  ): THREE.Vector2 {
    const eye = camera.position.clone().sub(origin).normalize()
    const tangent = new THREE.Vector3().crossVectors(worldAxisFor(axis), eye)
    if (tangent.lengthSq() < 1e-8) tangent.setFromMatrixColumn(camera.matrixWorld, 0)
    tangent.normalize()
    const start = origin.clone().project(camera)
    const end = origin.clone().add(tangent).project(camera)
    const screen = new THREE.Vector2(end.x - start.x, -(end.y - start.y))
    if (screen.lengthSq() < 1e-8) return new THREE.Vector2(1, 0)
    return screen.normalize()
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!editor.isEditing.value || event.button !== 0) return

    const axis = pickRotationHandle(event)
    if (axis === null) return
    setRotationHandleHover(axis)
    const storeId = editor.selectedBoneId.value
    const camera = bridge.camera.value
    const target = gizmoTarget
    if (storeId === null || camera === null || target === null) return

    event.preventDefault()
    event.stopImmediatePropagation()
    editor.beginBoneDrag(storeId, editor.editFrame.value)
    const origin = target.getWorldPosition(new THREE.Vector3())
    rotationDrag = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tangent: screenTangent(axis, origin, camera),
    }
    isGizmoDragging = true
    bridge.isGizmoDragging.value = true
    const orbit = bridge.orbitControls.value
    if (orbit !== null) orbit.enabled = false
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
  }

  function handlePointerMove(event: PointerEvent): void {
    const drag = rotationDrag
    if (drag === null || event.pointerId !== drag.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    const angle = (deltaX * drag.tangent.x + deltaY * drag.tangent.y)
      * ROTATION_DRAG_DEGREES_PER_PIXEL
    editor.dragBoneRotation(drag.axis, angle * ROTATION_POSE_SIGN[drag.axis])
    scheduleRebuild()
  }

  function handlePointerUp(event: PointerEvent): void {
    if (rotationDrag === null || event.pointerId !== rotationDrag.pointerId) return
    finishRotationDrag()
  }

  function finishRotationDrag(): void {
    rotationDrag = null
    isGizmoDragging = false
    bridge.isGizmoDragging.value = false
    editor.endBoneDrag()
    const orbit = bridge.orbitControls.value
    if (orbit !== null) orbit.enabled = true
    window.removeEventListener('pointermove', handlePointerMove, true)
    window.removeEventListener('pointerup', handlePointerUp, true)
    scheduleRebuild()
  }

  function resetDrag(): void {
    const hadDrag = rotationDrag !== null || isGizmoDragging
    rotationDrag = null
    setRotationHandleHover(null)
    if (hadDrag) {
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
    pointerContainer.removeEventListener('pointermove', handlePointerHover, true)
    pointerContainer.removeEventListener('pointerleave', handlePointerLeave)
    pointerContainer = null
  }

  function attachContainer(container: HTMLDivElement | null): void {
    detachContainer()
    if (container === null) return
    container.addEventListener('pointerdown', handlePointerDown, true)
    container.addEventListener('pointermove', handlePointerHover, true)
    container.addEventListener('pointerleave', handlePointerLeave)
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
  watch(() => editor.isScrubbing.value, scheduleRebuild)
  watch(() => editor.hiddenBoneIds.value, (ids: ReadonlySet<number>): void => {
    bridge.hiddenBoneIds.value = ids
    bridge.player.value?.setAnimations(editor.activeAnimations.value)
    scheduleRebuild()
  }, { immediate: true })
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
    bridge.hiddenBoneIds.value = new Set<number>()
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
    if (rotationHandles !== null) {
      rotationHandles.removeFromParent()
      rotationHandles.traverse((object): void => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const { material } = object
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      })
      rotationHandles = null
    }
    rotationPickers.length = 0
    rotationHandleMaterials.clear()
    hoveredRotationAxis = null
    overlay?.removeFromParent()
    overlay = null
    tipCache.clear()
  })
}
