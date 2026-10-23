export interface DragVec3 {
  x: number
  y: number
  z: number
}

export const DRAG_STEP = 0.01

export function poseDeltaFromLocalDelta(delta: DragVec3): DragVec3 {
  return { x: delta.x, y: negate(delta.y), z: negate(delta.z) }
}

export function quantizeDragDelta(value: number, step: number = DRAG_STEP): number {
  if (!Number.isFinite(value) || step <= 0) return 0
  return Number((Math.round(value / step) * step).toFixed(4))
}

function negate(value: number): number {
  return value === 0 ? 0 : -value
}
