import { describe, expect, it } from 'vitest'
import { encodePngSkin, type SkinImage } from '../skinPng'
import { normalizeSkin } from '../skinNormalize'

function patternImage(width: number, height: number): SkinImage {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      rgba[offset] = (x * 7) % 256
      rgba[offset + 1] = (y * 13) % 256
      rgba[offset + 2] = (x + y) % 256
      rgba[offset + 3] = 255
    }
  }
  return { width, height, rgba }
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

function expectMirroredFace(
  result: SkinImage,
  source: SkinImage,
  dstRect: [number, number, number, number],
  srcRect: [number, number, number, number],
  scale: number,
): void {
  const [dstX, dstY, rectW, rectH] = dstRect
  const [srcX, srcY] = srcRect
  const physW = rectW * scale
  const physH = rectH * scale
  for (let y = 0; y < physH; y++) {
    for (let x = 0; x < physW; x++) {
      const dstXPixel = dstX * scale + (physW - 1 - x)
      const dstYPixel = dstY * scale + y
      expect(pixelAt(result, dstXPixel, dstYPixel)).toEqual(
        pixelAt(source, srcX * scale + x, srcY * scale + y),
      )
    }
  }
}

function expectTransparent(image: SkinImage, x: number, y: number): void {
  expect(pixelAt(image, x, y)).toEqual([0, 0, 0, 0])
}

const LEGACY_PNG = async (scale: number): Promise<{ bytes: Uint8Array, source: SkinImage }> => {
  const source = patternImage(64 * scale, 32 * scale)
  return { bytes: await encodePngSkin(source), source }
}

describe('normalizeSkin', () => {
  it('doubles a 64x32 legacy skin and bakes mirrored left limbs', async () => {
    const { bytes, source } = await LEGACY_PNG(1)

    const result = await normalizeSkin(bytes)

    expect(result.width).toBe(64)
    expect(result.height).toBe(64)
    expect(Array.from(result.rgba.subarray(0, 64 * 32 * 4))).toEqual(Array.from(source.rgba))

    expectMirroredFace(result, source, [24, 52, 4, 12], [0, 20, 4, 12], 1)
    expectMirroredFace(result, source, [16, 52, 4, 12], [8, 20, 4, 12], 1)
    expectMirroredFace(result, source, [20, 52, 4, 12], [4, 20, 4, 12], 1)
    expectMirroredFace(result, source, [28, 52, 4, 12], [12, 20, 4, 12], 1)
    expectMirroredFace(result, source, [20, 48, 4, 4], [4, 16, 4, 4], 1)
    expectMirroredFace(result, source, [24, 48, 4, 4], [8, 16, 4, 4], 1)

    expectMirroredFace(result, source, [40, 52, 4, 12], [40, 20, 4, 12], 1)
    expectMirroredFace(result, source, [32, 52, 4, 12], [48, 20, 4, 12], 1)
    expectMirroredFace(result, source, [36, 52, 4, 12], [44, 20, 4, 12], 1)
    expectMirroredFace(result, source, [44, 52, 4, 12], [52, 20, 4, 12], 1)
    expectMirroredFace(result, source, [36, 48, 4, 4], [44, 16, 4, 4], 1)
    expectMirroredFace(result, source, [40, 48, 4, 4], [48, 16, 4, 4], 1)

    expectTransparent(result, 0, 48)
    expectTransparent(result, 15, 63)
    expectTransparent(result, 32, 40)
    expectTransparent(result, 63, 63)
    expectTransparent(result, 0, 32)
  })

  it('doubles a 128x64 legacy skin in native resolution', async () => {
    const { bytes, source } = await LEGACY_PNG(2)

    const result = await normalizeSkin(bytes)

    expect(result.width).toBe(128)
    expect(result.height).toBe(128)
    expect(Array.from(result.rgba.subarray(0, 128 * 64 * 4))).toEqual(Array.from(source.rgba))
    expectMirroredFace(result, source, [24, 52, 4, 12], [0, 20, 4, 12], 2)
    expectMirroredFace(result, source, [36, 52, 4, 12], [44, 20, 4, 12], 2)
    expectTransparent(result, 0, 96)
    expectTransparent(result, 127, 127)
  })

  it('passes a square skin through unchanged', async () => {
    const source = patternImage(64, 64)
    const bytes = await encodePngSkin(source)

    const result = await normalizeSkin(bytes)

    expect(result.width).toBe(64)
    expect(result.height).toBe(64)
    expect(Array.from(result.rgba)).toEqual(Array.from(source.rgba))
  })

  it('passes an HD square skin through unchanged', async () => {
    const source = patternImage(512, 512)
    const result = await normalizeSkin(await encodePngSkin(source))
    expect(result.width).toBe(512)
    expect(Array.from(result.rgba)).toEqual(Array.from(source.rgba))
  })

  it('rejects a skin with an unsupported aspect', async () => {
    const bytes = await encodePngSkin(patternImage(64, 48))
    await expect(normalizeSkin(bytes)).rejects.toThrow('Скин 64×48')
  })
})
