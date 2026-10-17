import { describe, expect, it } from 'vitest'
import { applyNumberStep } from '../numberStep'

describe('applyNumberStep', () => {
  it('increments and decrements by the step', () => {
    expect(applyNumberStep(5, 1, 1)).toBe(6)
    expect(applyNumberStep(5, -1, 1)).toBe(4)
  })

  it('keeps the fraction of the current value for an integer step', () => {
    expect(applyNumberStep(12.5, 1, 1)).toBe(13.5)
  })

  it('rounds fractional steps without float noise', () => {
    expect(applyNumberStep(0.2, 1, 0.1)).toBe(0.3)
    expect(applyNumberStep(0.3, -1, 0.1)).toBe(0.2)
  })

  it('clamps the result to the bounds', () => {
    expect(applyNumberStep(8, 1, 1, 0, 8)).toBe(8)
    expect(applyNumberStep(0, -1, 1, 0, 8)).toBe(0)
    expect(applyNumberStep(7, 1, 1, 0, 8)).toBe(8)
  })

  it('falls back to a step of one for invalid steps', () => {
    expect(applyNumberStep(1, 1, 0)).toBe(2)
    expect(applyNumberStep(1, 1, Number.NaN)).toBe(2)
  })

  it('uses zero for a non-finite current value', () => {
    expect(applyNumberStep(Number.NaN, 1, 1)).toBe(1)
  })
})
