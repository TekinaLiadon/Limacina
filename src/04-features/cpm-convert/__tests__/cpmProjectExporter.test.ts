import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { CPMChild, CPMConfig, CPMElement } from '@/05-entities'
import { bytesToBase64 } from '../cpmBinaryWriter'
import {
  cpmConfigToBytes,
  cpmConfigToLinkBytes,
  cpmProjectToBytes,
  cpmProjectToLinkBase64,
} from '../cpmProjectExporter'

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

const makeRoot = (id: string): CPMElement => ({
  id,
  name: id,
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  children: [],
})

const rootsConfig = (elements: CPMElement[]): CPMConfig => ({
  skinSize: { x: 64, y: 64 },
  elements,
})

const bytesOfChild = (overrides: Partial<CPMChild>): Uint8Array =>
  cpmConfigToLinkBytes(makeConfig([makeChild(overrides)]))

describe('definition structure from the mod sources', () => {
  it('wires nested cubes to their parent cube id starting from 10', () => {
    const inner = makeChild({
      textureSize: 64,
      size: { x: 4, y: 4, z: 4 },
      pos: { x: 2, y: 0, z: 0 },
      u: 24,
      v: 8,
    })
    const outer = makeChild({ textureSize: 64, u: 16, v: 16, children: [inner] })
    const bytes = cpmConfigToLinkBytes(makeConfig([outer]))

    expect([...bytes]).toEqual([
      83, 2,
      80, 80, 80,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 64, 16, 16,
      40, 40, 40,
      5, 84, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      10, 64, 24, 8,
      1, 1, 1,
      8, 2, 8, 0,
      0, 0,
      2, 162,
    ])
    expect(bytes[24]).toBe(64)
    expect(bytes[48]).toBe(10)
  })

  it('clears the PLAYER keep bit for a hidden root part', () => {
    const bytes = cpmConfigToLinkBytes(rootsConfig([{ ...makeRoot('head'), show: false }]))

    expect([...bytes]).toEqual([83, 0, 1, 1, 0, 8, 2, 8, 0, 0, 0, 0, 20])
  })

  it('sets one PLAYER keep bit per visible root part', () => {
    const bytes = cpmConfigToLinkBytes(rootsConfig([makeRoot('head'), makeRoot('body')]))

    expect([...bytes]).toEqual([83, 0, 1, 1, 3, 8, 2, 8, 0, 0, 0, 0, 23])
  })

  it('emits PLAYER_PARTPOS above the 0.1 epsilon like Exporter.prepareDefinition', () => {
    const bytes = cpmConfigToLinkBytes(
      rootsConfig([{ ...makeRoot('head'), pos: { x: 0.2, y: 0, z: 0 } }]),
    )

    expect([...bytes]).toEqual([
      83, 0, 1, 1, 1,
      7, 13, 0, 0, 136, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      8, 2, 8, 0,
      0, 0,
      0, 177,
    ])
  })

  it('skips PLAYER_PARTPOS inside the epsilon window', () => {
    const bytes = cpmConfigToLinkBytes(
      rootsConfig([{ ...makeRoot('head'), pos: { x: 0.05, y: 0, z: 0 } }]),
    )

    expect([...bytes]).toEqual([83, 0, 1, 1, 1, 8, 2, 8, 0, 0, 0, 0, 21])
  })

  it('emits PLAYER_PARTPOS for rotation-only offsets with the angle short', () => {
    const bytes = cpmConfigToLinkBytes(
      rootsConfig([{ ...makeRoot('head'), rotation: { x: 0, y: 0, z: 90 } }]),
    )

    expect(containsSequence(bytes, [7, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0])).toBe(true)
  })

  it('emits a pivot cube under the custom part slot for customPart roots', () => {
    const bytes = cpmConfigToLinkBytes(
      rootsConfig([{ ...makeRoot('custom_part'), customPart: true, children: [makeChild()] }]),
    )

    expect(containsSequence(bytes, [6, 0, 0, 0, 0, 80, 80, 80])).toBe(true)
    expect(containsSequence(bytes, [0, 0, 0, 0, 0, 0, 10, 1, 0, 0])).toBe(true)
    expect(containsSequence(bytes, [1, 1, 0])).toBe(true)
    expect(containsSequence(bytes, [12, 2, 10, 0])).toBe(true)
    expect(containsSequence(bytes, [14, 2, 10, 0])).toBe(false)
  })

  it('emits DUP_ROOT with a pivot cube for duplicated roots', () => {
    const bytes = cpmConfigToLinkBytes(rootsConfig([{ ...makeRoot('head'), dup: true }]))

    expect(containsSequence(bytes, [6, 0, 0, 0, 0])).toBe(true)
    expect(containsSequence(bytes, [14, 2, 10, 0])).toBe(true)
    expect(containsSequence(bytes, [8, 2, 2, 10])).toBe(false)

    const hidden = cpmConfigToLinkBytes(rootsConfig([{ ...makeRoot('head'), dup: true, show: false }]))
    expect(containsSequence(hidden, [8, 2, 2, 10])).toBe(true)
  })

  it('emits MODEL_ROOT with the RootModelType ordinal for vanilla root models', () => {
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([makeRoot('cape')])), [12, 2, 10, 0])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([makeRoot('elytra_left')])), [12, 2, 10, 1])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([makeRoot('armor_helmet')])), [12, 2, 10, 3])).toBe(true)

    const hidden = cpmConfigToLinkBytes(rootsConfig([{ ...makeRoot('armor_body'), show: false }]))
    expect(containsSequence(hidden, [8, 2, 2, 10])).toBe(true)
    expect(containsSequence(hidden, [12, 2, 10, 4])).toBe(true)
  })

  it('keeps unknown roots as plain pivot cubes without root blocks', () => {
    const bytes = cpmConfigToLinkBytes(rootsConfig([makeRoot('weird_root')]))

    expect(containsSequence(bytes, [6, 0, 0, 0, 0])).toBe(true)
    expect(containsSequence(bytes, [12, 2, 10])).toBe(false)
    expect(containsSequence(bytes, [14, 2, 10])).toBe(false)
  })

  it('emits DISABLE_VANILLA for roots that opt out of vanilla animation', () => {
    const bytes = cpmConfigToLinkBytes(rootsConfig([{ ...makeRoot('head'), disableVanillaAnim: true }]))

    expect(containsSequence(bytes, [8, 2, 16, 0])).toBe(true)
  })
})

describe('render effects from the mod sources', () => {
  it('emits the render effect payloads exactly like the mod exporter', () => {
    expect(containsSequence(bytesOfChild({ glow: true }), [8, 2, 0, 10])).toBe(true)
    expect(
      containsSequence(bytesOfChild({ mcScale: 0.5 }), [8, 10, 1, 10, 1, 85, 2, 170, 2, 170, 2, 170]),
    ).toBe(true)
    expect(
      containsSequence(bytesOfChild({ scale: { x: 1.5, y: 1, z: 1 } }), [
        8, 10, 1, 10, 0, 0, 3, 255, 2, 170, 2, 170,
      ]),
    ).toBe(true)
    expect(containsSequence(bytesOfChild({ hidden: true }), [8, 2, 2, 10])).toBe(true)
    expect(containsSequence(bytesOfChild({ recolor: true, color: 'FF0000' }), [8, 5, 3, 10, 255, 0, 0])).toBe(true)
    expect(containsSequence(bytesOfChild({ singleTex: true }), [8, 2, 4, 10])).toBe(true)
    expect(containsSequence(bytesOfChild({ extrude: true }), [8, 2, 10, 10])).toBe(true)
    expect(containsSequence(bytesOfChild({ u: 300, v: 2 }), [8, 5, 6, 10, 172, 2, 2])).toBe(true)
  })

  it('writes per-face uv as a direction bitmask with rot ordinals', () => {
    const bytes = bytesOfChild({
      faceUV: {
        up: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '0', autoUV: false },
        west: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '270', autoUV: false },
      },
    })

    expect(containsSequence(bytes, [8, 13, 5, 10, 33, 0, 0, 8, 8, 0, 0, 0, 8, 8, 3])).toBe(true)
  })

  it('emits effects per cube in the mod export order', () => {
    const bytes = bytesOfChild({
      glow: true,
      hidden: true,
      recolor: true,
      color: 'FF0000',
      singleTex: true,
      extrude: true,
    })

    expect(
      containsSequence(bytes, [
        8, 2, 0, 10,
        8, 2, 2, 10,
        8, 5, 3, 10, 255, 0, 0,
        8, 2, 4, 10,
        8, 2, 10, 10,
      ]),
    ).toBe(true)
  })

  it('emits SCALING as the ENTITY scaling option', () => {
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), scaling: 1.5 }), [8, 4, 13, 0, 3, 255])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), scaling: 1 }), [8, 4, 13])).toBe(false)
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), scaling: 0 }), [8, 4, 13])).toBe(false)
  })

  it('omits HIDE_SKULL only when hideHeadIfSkull is on', () => {
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([])), [8, 2, 8, 0])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), hideHeadIfSkull: true }), [8, 2, 8, 0])).toBe(false)
  })

  it('emits optional config effects', () => {
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), removeArmorOffset: true }), [8, 2, 9, 1])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), removeBedOffset: true }), [8, 1, 17])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes({ ...rootsConfig([]), enableInvisGlow: true }), [8, 1, 18])).toBe(true)
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([])), [8, 2, 9, 1])).toBe(false)
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([])), [8, 1, 17])).toBe(false)
    expect(containsSequence(cpmConfigToLinkBytes(rootsConfig([])), [8, 1, 18])).toBe(false)
  })
})

describe('checksum from ChecksumOutputStream', () => {
  it('appends the mod checksum as a big-endian short over all bytes after the header', () => {
    const bytes = cpmConfigToLinkBytes(rootsConfig([makeRoot('head')]))
    const sum = bytes.slice(1, bytes.length - 2).reduce((acc, b) => (acc + b) & 0xFFFF, 0)

    expect(((bytes[bytes.length - 2] ?? 0) << 8) | (bytes[bytes.length - 1] ?? 0)).toBe(sum)
  })

  it('wraps the checksum at 16 bits like the Java short accumulator', () => {
    const cubes = Array.from({ length: 300 }, (_, i) =>
      makeChild({ name: `Cube ${i}`, textureSize: 64, u: 16, v: 16 }),
    )
    const bytes = cpmConfigToLinkBytes(makeConfig(cubes))
    const raw = bytes.slice(1, bytes.length - 2).reduce((acc, b) => acc + b, 0)

    expect(raw).toBeGreaterThan(65535)
    expect(((bytes[bytes.length - 2] ?? 0) << 8) | (bytes[bytes.length - 1] ?? 0)).toBe(raw & 0xFFFF)
  })
})

describe('cpmProjectToBytes', () => {
  it('converts a project zip into the full byte format', async () => {
    const config = makeConfig([makeChild({ textureSize: 64 })])
    const skin = makePng(64, 64)
    const zip = new JSZip()
    zip.file('config.json', JSON.stringify(config))
    zip.file('skin.png', skin)
    const data = await zip.generateAsync({ type: 'uint8array' })

    expect([...(await cpmProjectToBytes(data))]).toEqual([...cpmConfigToBytes(config, skin)])
  })

  it('encodes the link format as base64', async () => {
    const config = makeConfig([makeChild({ textureSize: 64 })])
    const zip = new JSZip()
    zip.file('config.json', JSON.stringify(config))
    const data = await zip.generateAsync({ type: 'uint8array' })

    expect(await cpmProjectToLinkBase64(data)).toBe(bytesToBase64(cpmConfigToLinkBytes(config)))
  })
})
