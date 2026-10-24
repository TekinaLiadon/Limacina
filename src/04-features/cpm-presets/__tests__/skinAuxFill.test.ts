import { describe, expect, it } from 'vitest'
import type { PresetAuxRegion } from '../presetTypes'
import type { SkinImage } from '../skinPng'
import { fillAuxRegions } from '../skinAuxFill'

function patternImage(width: number): SkinImage {
  const rgba = new Uint8Array(width * width * 4)
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      rgba[offset] = (x * 5) % 256
      rgba[offset + 1] = (y * 9) % 256
      rgba[offset + 2] = 200
      rgba[offset + 3] = 255
    }
  }
  return { width, height: width, rgba }
}

function pixelAt(image: SkinImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return [
    image.rgba[offset] ?? 0,
    image.rgba[offset + 1] ?? 0,
    image.rgba[offset + 2] ?? 0,
    image.rgba[offset + 3] ?? 0,
  ]
}

const REGION: PresetAuxRegion = { name: 'body-aux', sx: 58, sy: 0, ex: 64, ey: 4 }

describe('fillAuxRegions', () => {
  it('clears the aux region pixels of a 64x64 skin', () => {
    const image = patternImage(64)

    const result = fillAuxRegions(image, [REGION])

    expect(result.width).toBe(64)
    expect(pixelAt(result, 58, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(result, 63, 3)).toEqual([0, 0, 0, 0])
    expect(pixelAt(result, 57, 0)).toEqual(pixelAt(image, 57, 0))
    expect(pixelAt(result, 58, 4)).toEqual(pixelAt(image, 58, 4))
    expect(pixelAt(result, 0, 0)).toEqual(pixelAt(image, 0, 0))
  })

  it('clears the scaled aux region of a 512x512 skin', () => {
    const image = patternImage(512)

    const result = fillAuxRegions(image, [REGION])

    expect(pixelAt(result, 464, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(result, 511, 31)).toEqual([0, 0, 0, 0])
    expect(pixelAt(result, 463, 0)).toEqual(pixelAt(image, 463, 0))
    expect(pixelAt(result, 464, 32)).toEqual(pixelAt(image, 464, 32))
    expect(pixelAt(result, 511, 32)).toEqual(pixelAt(image, 511, 32))
  })

  it('clears every region of the list', () => {
    const image = patternImage(64)
    const regions: PresetAuxRegion[] = [
      REGION,
      { name: 'spare', sx: 0, sy: 60, ex: 8, ey: 64 },
    ]

    const result = fillAuxRegions(image, regions)

    expect(pixelAt(result, 58, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(result, 7, 63)).toEqual([0, 0, 0, 0])
    expect(pixelAt(result, 8, 63)).toEqual(pixelAt(image, 8, 63))
  })

  it('skips quietly when the preset has no aux regions', () => {
    const image = patternImage(64)
    const before = Array.from(image.rgba)

    const withoutList = fillAuxRegions(image, undefined)
    const emptyList = fillAuxRegions(image, [])

    expect(Array.from(withoutList.rgba)).toEqual(before)
    expect(Array.from(emptyList.rgba)).toEqual(before)
  })

  it('does not mutate the input image', () => {
    const image = patternImage(64)
    const before = Array.from(image.rgba)

    fillAuxRegions(image, [REGION])

    expect(Array.from(image.rgba)).toEqual(before)
  })
})
