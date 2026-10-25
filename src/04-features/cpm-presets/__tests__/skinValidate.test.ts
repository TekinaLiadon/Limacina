import { describe, expect, it } from 'vitest'
import { MAX_SKIN_FILE_BYTES, validateSkin } from '../skinValidate'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function pngWithSize(width: number, height: number, extraBytes: number = 0): Uint8Array {
  const bytes = new Uint8Array(29 + extraBytes)
  bytes.set(PNG_SIGNATURE, 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

describe('validateSkin', () => {
  it('accepts a 64x64 skin with scale 1', () => {
    expect(validateSkin(pngWithSize(64, 64))).toEqual({
      width: 64,
      height: 64,
      scale: 1,
      errors: [],
    })
  })

  it('accepts a 128x128 skin with scale 2', () => {
    const result = validateSkin(pngWithSize(128, 128))
    expect(result.errors).toEqual([])
    expect(result.scale).toBe(2)
  })

  it('accepts a 512x512 skin with scale 8', () => {
    const result = validateSkin(pngWithSize(512, 512))
    expect(result.errors).toEqual([])
    expect(result.scale).toBe(8)
  })

  it('accepts a synthetic 1024x1024 header with scale 16', () => {
    const result = validateSkin(pngWithSize(1024, 1024))
    expect(result.errors).toEqual([])
    expect(result.scale).toBe(16)
  })

  it('accepts a legacy 64x32 skin', () => {
    const result = validateSkin(pngWithSize(64, 32))
    expect(result.errors).toEqual([])
    expect(result).toMatchObject({ width: 64, height: 32, scale: 1 })
  })

  it('accepts a legacy 128x64 skin', () => {
    const result = validateSkin(pngWithSize(128, 64))
    expect(result.errors).toEqual([])
    expect(result.scale).toBe(2)
  })

  it('rejects a file without the PNG signature', () => {
    const bytes = pngWithSize(64, 64)
    bytes[0] = 0x00
    const result = validateSkin(bytes)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('PNG')
  })

  it('rejects a width that is not a multiple of 64', () => {
    const result = validateSkin(pngWithSize(96, 96))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('64')
  })

  it('rejects a height that is neither square nor legacy half', () => {
    const result = validateSkin(pngWithSize(64, 48))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('64')
  })

  it('rejects a zero width', () => {
    const result = validateSkin(pngWithSize(0, 0))
    expect(result.errors).toHaveLength(1)
  })

  it('accepts a 2048x2048 skin with scale 32', () => {
    const result = validateSkin(pngWithSize(2048, 2048))
    expect(result.errors).toEqual([])
    expect(result.scale).toBe(32)
  })

  it('accepts a legacy 2880x1440 skin within the pixel budget', () => {
    const result = validateSkin(pngWithSize(2880, 1440))
    expect(result.errors).toEqual([])
    expect(result.scale).toBe(45)
  })

  it('rejects a skin above the pixel budget', () => {
    const result = validateSkin(pngWithSize(8128, 8128))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('слишком большой')
  })

  it('rejects a legacy skin above the pixel budget', () => {
    const result = validateSkin(pngWithSize(2944, 1472))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('слишком большой')
  })

  it('rejects an oversized file', () => {
    const bytes = pngWithSize(64, 64, MAX_SKIN_FILE_BYTES)
    const result = validateSkin(bytes)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('2 МБ')
  })
})
