import { describe, expect, it } from 'vitest'
import { hasPngSignature } from '../png'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x10, 0x00, 0x57, 0x45, 0x42, 0x50,
])

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

describe('hasPngSignature', () => {
  it('accepts a file starting with the 8-byte PNG signature', () => {
    expect(hasPngSignature(PNG_BYTES)).toBe(true)
  })

  it('rejects renamed webp and jpeg payloads', () => {
    expect(hasPngSignature(WEBP_BYTES)).toBe(false)
    expect(hasPngSignature(JPEG_BYTES)).toBe(false)
  })

  it('rejects payloads shorter than the signature', () => {
    expect(hasPngSignature(PNG_BYTES.slice(0, 7))).toBe(false)
    expect(hasPngSignature(new Uint8Array(0))).toBe(false)
  })

  it('rejects a corrupted signature byte', () => {
    const bytes = PNG_BYTES.slice()
    bytes[3] = 0x51
    expect(hasPngSignature(bytes)).toBe(false)
  })
})
