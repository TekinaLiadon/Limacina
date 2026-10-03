import { describe, expect, it } from 'vitest'
import type { CPMChild, CPMConfig, CPMElement } from '@/05-entities'
import { cpmConfigToBytes, cpmConfigToLinkBytes } from './cpmProjectExporter'

const makeElement = (children: CPMChild[]): CPMElement => ({
  id: 'head',
  name: 'Head',
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  children,
})

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'Cube',
  size: { x: 8, y: 8, z: 8 },
  pos: { x: 0, y: 0, z: 0 },
  offset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  u: 0,
  v: 0,
  ...overrides,
})

const makeConfig = (children: CPMChild[]): CPMConfig => ({
  skinSize: { x: 64, y: 64 },
  elements: [makeElement(children)],
})

const TEXTURED_CUBE_64_GOLDEN = [
  83, 1,
  80, 80, 80,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 64, 0, 0,
  1, 1, 1,
  8, 2, 8, 0,
  0, 0,
  1, 70,
]

const MIRRORED_CUBE_64_GOLDEN = [
  83, 1,
  80, 80, 80,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 192, 0, 0,
  1, 1, 1,
  8, 2, 8, 0,
  0, 0,
  1, 198,
]

describe('cpmProjectExporter', () => {
  it('writes the mirrored texSize as a signed byte', () => {
    const bytes = cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 64, mirror: true })]))
    expect([...bytes]).toEqual(MIRRORED_CUBE_64_GOLDEN)
    expect(bytes[24]).toBe(192)
  })

  it('keeps the byte stream unchanged for plain textured cubes', () => {
    const bytes = cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 64 })]))
    expect([...bytes]).toEqual(TEXTURED_CUBE_64_GOLDEN)
    expect(bytes[24]).toBe(64)
  })

  it('writes rgb bytes for textureless cubes', () => {
    const bytes = cpmConfigToLinkBytes(makeConfig([makeChild({ texture: false, color: 'FF8000' })]))
    expect([...bytes]).toEqual([
      83, 1,
      80, 80, 80,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 255, 128, 0,
      1, 1, 1,
      8, 2, 8, 0,
      0, 0,
      2, 133,
    ])
  })

  it('wraps the definition into the full byte format', () => {
    const bytes = cpmConfigToBytes(makeConfig([makeChild({ textureSize: 64, mirror: true })]))
    expect([...bytes]).toEqual([
      83, 11, 1, 1,
      3, 35,
      1,
      80, 80, 80,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 192, 0, 0,
      1, 1, 1,
      8, 2, 8, 0,
      0, 0,
      0, 0,
      1, 249,
    ])
  })

  it('rounds away float noise inside the epsilon window', () => {
    const bytes = cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 64.000000001 })]))
    expect([...bytes]).toEqual(TEXTURED_CUBE_64_GOLDEN)
  })

  it('rejects fractional textureSize instead of truncating it to a byte', () => {
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 0.5 })]))).toThrow(/texSize/)
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 63.5 })]))).toThrow(/texSize/)
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 64.5, mirror: true })]))).toThrow(/texSize/)
    expect(() => cpmConfigToBytes(makeConfig([makeChild({ textureSize: 0.5 })]))).toThrow(/texSize/)
  })

  it('rejects texSize values that do not fit a signed byte', () => {
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 300 })]))).toThrow(/texSize/)
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 200 })]))).toThrow(/texSize/)
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ textureSize: 200, mirror: true })]))).toThrow(/texSize/)
  })

  it('rejects a cube size that does not fit the unsigned byte range', () => {
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ size: { x: 30, y: 8, z: 8 } })]))).toThrow(
      /Размер куба «Cube»/,
    )
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ size: { x: -1, y: 8, z: 8 } })]))).toThrow(
      /Размер куба «Cube»/,
    )
  })

  it('rejects a position that does not fit the vector range', () => {
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ pos: { x: 100, y: 0, z: 0 } })]))).toThrow(
      /не помещается/,
    )
    expect(() => cpmConfigToLinkBytes(makeConfig([makeChild({ offset: { x: 0, y: -60, z: 0 } })]))).toThrow(
      /не помещается/,
    )
  })

  it('emits UV_OVERFLOW for a cube with faceUV and overflowing u/v', () => {
    const child = makeChild({
      textureSize: 64,
      u: 300,
      v: 2,
      faceUV: { east: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '0', autoUV: false } },
    })
    const bytes = cpmConfigToLinkBytes(makeConfig([child]))

    expect(containsSequence(bytes, [8, 5, 6, 10, 172, 2, 2])).toBe(true)
  })

  it('skips UV_OVERFLOW while the u/v values stay in a byte', () => {
    const child = makeChild({
      textureSize: 64,
      faceUV: { east: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '0', autoUV: false } },
    })
    const bytes = cpmConfigToLinkBytes(makeConfig([child]))

    expect(containsSequence(bytes, [8, 4, 6, 10, 0, 0])).toBe(false)
  })
})

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function makePng(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(24)
  PNG_SIGNATURE.forEach((byte, index) => {
    bytes[index] = byte
  })
  bytes[16] = (w >>> 24) & 0xFF
  bytes[17] = (w >>> 16) & 0xFF
  bytes[18] = (w >>> 8) & 0xFF
  bytes[19] = w & 0xFF
  bytes[20] = (h >>> 24) & 0xFF
  bytes[21] = (h >>> 16) & 0xFF
  bytes[22] = (h >>> 8) & 0xFF
  bytes[23] = h & 0xFF
  return bytes
}

function containsSequence(bytes: Uint8Array, sequence: Array<number>): boolean {
  return bytes.some((_, index) =>
    sequence.every((expected, offset) => bytes[index + offset] === expected),
  )
}

describe('cpmConfigToBytes skin block', () => {
  it('writes the skin block with dimensions from a valid png header', () => {
    const bytes = cpmConfigToBytes(makeConfig([]), makePng(0x0123, 0x0456))

    expect(containsSequence(bytes, [0x01, 0x23, 0x04, 0x56])).toBe(true)
  })

  it('omits the skin block when there is no skin', () => {
    const bytes = cpmConfigToBytes(makeConfig([]), null)

    expect(containsSequence(bytes, [0x01, 0x23, 0x04, 0x56])).toBe(false)
  })

  it('throws a clear error for a file without a png signature', () => {
    expect(() => cpmConfigToBytes(makeConfig([]), new Uint8Array([1, 2, 3, 4]))).toThrow(
      'Некорректный skin.png в файле проекта',
    )
  })

  it('throws a clear error for a truncated png header', () => {
    expect(() => cpmConfigToBytes(makeConfig([]), makePng(64, 64).slice(0, 20))).toThrow(
      'Некорректный skin.png в файле проекта',
    )
  })
})
