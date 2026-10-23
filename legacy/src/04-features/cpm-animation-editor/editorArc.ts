import * as THREE from 'three'
import type { AnimatedNode, NodeIndex } from '../cpm-viewer/cpmAnimationPlayer'

export const ARC_FRAME_RADIUS = 6
export const ARC_SUBSTEPS = 2
export const GHOST_DEFAULT_BEFORE = 0
export const GHOST_DEFAULT_AFTER = 0
export const GHOST_MAX_FRAMES = 8

export interface ArcFrameRange {
  start: number
  end: number
}

export interface EditorGhostFrame {
  frame: number
  offset: number
}

export function arcFrameRange(
  currentFrame: number,
  frameCount: number,
  radius: number = ARC_FRAME_RADIUS,
): ArcFrameRange {
  if (frameCount <= 0) return { start: 0, end: 0 }
  const lastFrame = frameCount - 1
  const center = Math.min(lastFrame, Math.max(0, Math.round(currentFrame)))
  const safeRadius = Math.max(0, Math.round(radius))
  return {
    start: Math.max(0, center - safeRadius),
    end: Math.min(lastFrame, center + safeRadius),
  }
}

export function arcSampleFrames(range: ArcFrameRange, substeps: number = ARC_SUBSTEPS): number[] {
  if (range.end < range.start) return []
  const stepCount = Math.max(1, Math.round(substeps))
  const result: number[] = []
  for (let step = range.start * stepCount; step <= range.end * stepCount; step++) {
    result.push(step / stepCount)
  }
  return result
}

export function ghostFrames(
  currentFrame: number,
  before: number,
  after: number,
  frameCount: number,
): EditorGhostFrame[] {
  if (frameCount <= 0) return []
  const result: EditorGhostFrame[] = []
  const safeBefore = clampGhostCount(before)
  const safeAfter = clampGhostCount(after)
  for (let offset = -safeBefore; offset <= safeAfter; offset++) {
    if (offset === 0) continue
    const frame = currentFrame + offset
    if (frame < 0 || frame >= frameCount) continue
    result.push({ frame, offset })
  }
  return result
}

export function clampGhostCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(GHOST_MAX_FRAMES, Math.max(0, Math.round(value)))
}

function restLocalMatrix(object: THREE.Object3D, index: NodeIndex): THREE.Matrix4 {
  if (object instanceof THREE.Group) {
    const storeId = object.userData.storeID
    const base = typeof storeId === 'number' ? index.get(storeId) : undefined
    if (base !== undefined && base.group === object) {
      const rotation = new THREE.Quaternion().setFromEuler(base.baseRot)
      return new THREE.Matrix4().compose(base.basePos, rotation, base.baseScale)
    }
  }
  object.updateMatrix()
  return object.matrix.clone()
}

function expandMeshBox(
  target: THREE.Box3,
  mesh: THREE.Mesh,
  parentMatrix: THREE.Matrix4,
): void {
  if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox()
  const {boundingBox} = mesh.geometry
  if (boundingBox === null) return
  mesh.updateMatrix()
  const matrix = parentMatrix.clone().multiply(mesh.matrix)
  target.union(boundingBox.clone().applyMatrix4(matrix))
}

function collectSubtreeBox(node: AnimatedNode, index: NodeIndex): THREE.Box3 {
  const box = new THREE.Box3()
  const visit = (object: THREE.Object3D, parentMatrix: THREE.Matrix4): void => {
    for (const child of object.children) {
      if (child instanceof THREE.Mesh) {
        expandMeshBox(box, child, parentMatrix)
        continue
      }
      visit(child, parentMatrix.clone().multiply(restLocalMatrix(child, index)))
    }
  }
  visit(node.group, new THREE.Matrix4())
  return box
}

function collectOwnBox(node: AnimatedNode): THREE.Box3 {
  const box = new THREE.Box3()
  for (const child of node.group.children) {
    if (child instanceof THREE.Mesh) expandMeshBox(box, child, new THREE.Matrix4())
  }
  return box
}

export function computeBoneTipLocal(node: AnimatedNode, index: NodeIndex): THREE.Vector3 {
  const own = collectOwnBox(node)
  const box = own.isEmpty() && node.isRoot ? collectSubtreeBox(node, index) : own
  if (box.isEmpty()) return new THREE.Vector3()

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const tip = center.clone()

  if (size.x >= size.y && size.x >= size.z) {
    tip.x = center.x >= 0 ? box.max.x : box.min.x
  } else if (size.y >= size.z) {
    tip.y = center.y >= 0 ? box.max.y : box.min.y
  } else {
    tip.z = center.z >= 0 ? box.max.z : box.min.z
  }

  return tip
}

export function boneTipWorld(node: AnimatedNode, tipLocal: THREE.Vector3): THREE.Vector3 {
  node.group.updateWorldMatrix(true, false)
  return node.group.localToWorld(tipLocal.clone())
}
