import { describe, expect, it } from 'vitest'
import { poseDeltaFromLocalDelta, quantizeDragDelta } from '../editorDrag'

const vec = (x = 0, y = 0, z = 0): { x: number; y: number; z: number } => ({ x, y, z })

describe('poseDeltaFromLocalDelta', () => {
  it('inverts the viewer axes into the animation position axes', () => {
    expect(poseDeltaFromLocalDelta(vec(2, 3, 4))).toEqual(vec(2, -3, -4))
  })

  it('keeps an empty delta empty', () => {
    expect(poseDeltaFromLocalDelta(vec())).toEqual(vec())
  })
})

describe('quantizeDragDelta', () => {
  it('rounds the delta to the drag step', () => {
    expect(quantizeDragDelta(0.026)).toBe(0.03)
    expect(quantizeDragDelta(-0.026)).toBe(-0.03)
    expect(quantizeDragDelta(0.004)).toBe(0)
    expect(quantizeDragDelta(1.237)).toBe(1.24)
  })

  it('rejects invalid input', () => {
    expect(quantizeDragDelta(Number.NaN)).toBe(0)
    expect(quantizeDragDelta(1, 0)).toBe(0)
  })
})
