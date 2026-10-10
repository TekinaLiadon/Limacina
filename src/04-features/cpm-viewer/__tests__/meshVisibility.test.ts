import { describe, expect, it } from 'vitest'
import { computeMeshVisible } from '../meshVisibility'

describe('computeMeshVisible', () => {
  it('shows a layerless mesh while its animation visibility is on', () => {
    expect(computeMeshVisible(true, undefined, [])).toBe(true)
  })

  it('hides the mesh when its animation visibility is off', () => {
    expect(computeMeshVisible(false, undefined, [])).toBe(false)
  })

  it('shows a layered mesh only while its layer is active', () => {
    expect(computeMeshVisible(true, 2, [1, 2])).toBe(true)
    expect(computeMeshVisible(true, 2, [1, 3])).toBe(false)
  })

  it('composes animation visibility with the layer state', () => {
    expect(computeMeshVisible(false, 2, [2])).toBe(false)
  })

  it('treats both layer branches consistently', () => {
    expect(computeMeshVisible(true, undefined, [2]))
      .toBe(computeMeshVisible(true, 2, [2]))
    expect(computeMeshVisible(false, undefined, [2]))
      .toBe(computeMeshVisible(false, 2, [2]))
  })
})
