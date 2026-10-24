import { describe, expect, it } from 'vitest'
import { downscaleSkin } from '../downscaleSkin'
import type { SkinImage } from '../skinPng'

function makeImage(size: number): SkinImage {
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      rgba[offset] = x % 256
      rgba[offset + 1] = y % 256
      rgba[offset + 2] = 40
      rgba[offset + 3] = 255
    }
  }
  return { width: size, height: size, rgba }
}

const pixel = (image: SkinImage, x: number, y: number): number[] => {
  const offset = (y * image.width + x) * 4
  return [0, 1, 2, 3].map((channel) => image.rgba[offset + channel] ?? -1)
}

describe('downscaleSkin', () => {
  it('keeps the image when the target size is not smaller', () => {
    const image = makeImage(64)

    expect(downscaleSkin(image, 64)).toBe(image)
    expect(downscaleSkin(image, 128)).toBe(image)
  })

  it('halves a 128×128 skin to 64×64 with nearest pixels', () => {
    const scaled = downscaleSkin(makeImage(128), 64)

    expect(scaled.width).toBe(64)
    expect(scaled.height).toBe(64)
    expect(scaled.rgba).toHaveLength(64 * 64 * 4)
    expect(pixel(scaled, 0, 0)).toEqual([0, 0, 40, 255])
    expect(pixel(scaled, 1, 0)).toEqual([2, 0, 40, 255])
    expect(pixel(scaled, 0, 1)).toEqual([0, 2, 40, 255])
    expect(pixel(scaled, 63, 63)).toEqual([126, 126, 40, 255])
  })

  it('quarters a 256×256 skin to 64×64', () => {
    const scaled = downscaleSkin(makeImage(256), 64)

    expect(scaled.width).toBe(64)
    expect(pixel(scaled, 5, 7)).toEqual([20, 28, 40, 255])
    expect(pixel(scaled, 63, 0)).toEqual([252, 0, 40, 255])
  })

  it('preserves fully transparent aux pixels', () => {
    const image = makeImage(128)
    image.rgba.fill(0)

    const scaled = downscaleSkin(image, 64)

    expect(pixel(scaled, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(scaled, 63, 63)).toEqual([0, 0, 0, 0])
  })
})
