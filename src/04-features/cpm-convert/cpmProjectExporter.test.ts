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
})
