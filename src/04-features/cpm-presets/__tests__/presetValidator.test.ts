import { describe, expect, it } from 'vitest'
import {
  maxPresetSkinScale,
  skinScaleOf,
  validatePresetConfig,
  validatePresetMeta,
  validatePresetPair,
  validatePresetSkinFit,
} from '../presetValidator'
import { LOGICAL_ATLAS_SIZE } from '../presetTypes'
import type { CPMChild, CPMConfig, CPMElement, CPMFaceUV, CPMVec3 } from '@/05-entities'

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'cube',
  size: { x: 8, y: 12, z: 4 },
  offset: { x: 0, y: 0, z: 0 },
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  u: 16,
  v: 16,
  ...overrides,
})

const makeRoot = (id: string, children: CPMChild[] = [], overrides: Partial<CPMElement> = {}): CPMElement => ({
  id,
  name: id,
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  children,
  ...overrides,
})

const makeConfig = (elements: CPMElement[], overrides: Partial<CPMConfig> = {}): CPMConfig => ({
  skinSize: { x: LOGICAL_ATLAS_SIZE, y: LOGICAL_ATLAS_SIZE },
  elements,
  ...overrides,
})

describe('skinScaleOf', () => {
  it('returns the integer scale for vanilla and HD square skins', () => {
    expect(skinScaleOf(64, 64)).toBe(1)
    expect(skinScaleOf(128, 128)).toBe(2)
    expect(skinScaleOf(512, 512)).toBe(8)
  })

  it('accepts the maximum expressible scale bounded by the texSize byte', () => {
    expect(skinScaleOf(64 * 127, 64 * 127)).toBe(127)
  })

  it('rejects a scale above the validation ceiling', () => {
    expect(() => skinScaleOf(64 * 128, 64 * 128)).toThrow('Масштаб скина')
  })

  it('rejects a width that is not a multiple of the logical atlas', () => {
    expect(() => skinScaleOf(100, 100)).toThrow('кратна')
    expect(() => skinScaleOf(96, 96)).toThrow('кратна')
  })

  it('rejects non-square and legacy skins', () => {
    expect(() => skinScaleOf(64, 32)).toThrow('квадратным')
    expect(() => skinScaleOf(128, 64)).toThrow('квадратным')
  })

  it('rejects zero and non-finite sizes', () => {
    expect(() => skinScaleOf(0, 0)).toThrow('Некорректный размер скина')
    expect(() => skinScaleOf(Number.NaN, 64)).toThrow('Некорректный размер скина')
    expect(() => skinScaleOf(-64, -64)).toThrow('Некорректный размер скина')
  })
})

describe('validatePresetConfig', () => {
  it('accepts vanilla roots with standard skin box UVs', () => {
    const config = makeConfig([
      makeRoot('head', [makeChild({ name: 'head-cube', size: { x: 8, y: 8, z: 8 }, u: 0, v: 16 })]),
      makeRoot('body', [makeChild()]),
      makeRoot('left_arm', [makeChild({ size: { x: 4, y: 12, z: 4 }, u: 32, v: 48 })]),
      makeRoot('right_arm', [makeChild({ size: { x: 4, y: 12, z: 4 }, u: 40, v: 16 })]),
      makeRoot('left_leg', [makeChild({ size: { x: 4, y: 12, z: 4 }, u: 16, v: 48 })]),
      makeRoot('right_leg', [makeChild({ size: { x: 4, y: 12, z: 4 }, u: 0, v: 16 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('accepts a custom part root with per-face UVs including an empty aux face', () => {
    const config = makeConfig([
      makeRoot('custom_part', [
        makeChild({
          name: 'torso',
          faceUV: {
            north: { sx: 20, sy: 20, ex: 28, ey: 31, rot: '0', autoUV: false },
            east: { sx: 58, sy: 0, ex: 64, ey: 4, rot: '90', autoUV: false },
          },
        }),
      ], { customPart: true }),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('accepts a dup root referencing a vanilla part', () => {
    const config = makeConfig([makeRoot('head', [], { dup: true })])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('accepts a box UV layout ending exactly at the atlas edge', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ size: { x: 3.25, y: 3, z: 3.75 }, u: 48, v: 45 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('accepts cube sides up to the byte-format maximum', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ size: { x: 25.5, y: 12, z: 4 }, u: 0, v: 0 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('accepts byte-boundary texture sizes and denser layouts', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ textureSize: 127, size: { x: 0.125, y: 0.125, z: 0.125 }, u: 0, v: 0 })]),
      makeRoot('left_arm', [makeChild({ name: 'mir', mirror: true, textureSize: 128, size: { x: 0.125, y: 0.125, z: 0.125 }, u: 0, v: 0 })]),
      makeRoot('right_arm', [makeChild({ name: 'hd', textureSize: 2, size: { x: 8, y: 8, z: 8 }, u: 0, v: 16 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('accepts an untextured color cube without UV checks', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ texture: false, color: '#ff0000', u: -5, v: 999 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('validates single-tex cubes by their square side, not the box layout', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ singleTex: true, u: 44, v: 44 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('validates extruded cubes by their front face, not the box layout', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ extrude: true, u: 44, v: 48 })]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('rejects a skinSize other than the logical atlas', () => {
    const config = makeConfig([makeRoot('body')], { skinSize: { x: 128, y: 128 } })

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('skinSize пресета должен быть 64×64')
  })

  it('rejects an empty root list', () => {
    const errors = validatePresetConfig(makeConfig([]))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('хотя бы один корень')
  })

  it('rejects a box UV layout crossing the atlas on X', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ u: 48, v: 16 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('выходит за логический атлас')
  })

  it('rejects a box UV layout crossing the atlas on Y', () => {
    const config = makeConfig([
      makeRoot('head', [makeChild({ name: 'head-cube', size: { x: 8, y: 8, z: 8 }, u: 0, v: 56 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('выходит за логический атлас')
  })

  it('rejects a dense layout crossing the atlas through textureSize', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ textureSize: 2, size: { x: 8, y: 8, z: 8 }, u: 8, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('выходит за логический атлас')
  })

  it('rejects negative and fractional box UV coordinates', () => {
    const negative = validatePresetConfig(makeConfig([makeRoot('body', [makeChild({ u: -1 })])]))
    const fractional = validatePresetConfig(makeConfig([makeRoot('body', [makeChild({ v: 16.5 })])]))

    expect(negative).toHaveLength(1)
    expect(negative[0]).toContain('целыми неотрицательными')
    expect(fractional).toHaveLength(1)
    expect(fractional[0]).toContain('целыми неотрицательными')
  })

  it('rejects nested cube UV violations deep in the hierarchy', () => {
    const config = makeConfig([
      makeRoot('custom_part', [
        makeChild({
          name: 'outer',
          u: 0,
          v: 0,
          children: [makeChild({ name: 'inner', u: 56, v: 16 })],
        }),
      ], { customPart: true }),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"inner"')
  })

  it('rejects per-face UV outside the atlas', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({
          faceUV: { north: { sx: 20, sy: -2, ex: 28, ey: 31, rot: '0', autoUV: false } },
        }),
      ]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('north')
    expect(errors[0]).toContain('выходит за логический атлас')
  })

  it('rejects a per-face UV edge beyond the atlas', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({
          faceUV: { up: { sx: 58, sy: 0, ex: 70, ey: 4, rot: '0', autoUV: false } },
        }),
      ]),
    ])

    expect(validatePresetConfig(config)).toHaveLength(1)
  })

  it('rejects a degenerate per-face UV rect', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({
          faceUV: { north: { sx: 10, sy: 20, ex: 10, ey: 31, rot: '0', autoUV: false } },
        }),
      ]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('непустую область')
  })

  it('rejects an unknown per-face key', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({
          faceUV: { front: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '0', autoUV: false } },
        }),
      ]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('front')
  })

  it('rejects an unsupported per-face rotation', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({
          faceUV: { north: { sx: 0, sy: 0, ex: 8, ey: 8, rot: '45', autoUV: false } },
        }),
      ]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('0, 90, 180 или 270')
  })

  it('rejects cube sides above the byte maximum', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ size: { x: 26, y: 12, z: 4 }, u: 0, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('26')
  })

  it('rejects negative and non-finite cube sides', () => {
    const negative = validatePresetConfig(makeConfig([makeRoot('body', [makeChild({ size: { x: -1, y: 12, z: 4 } })])]))
    const broken = validatePresetConfig(
      makeConfig([makeRoot('body', [makeChild({ size: { x: Number.NaN, y: 12, z: 4 } })])]),
    )

    expect(negative).toHaveLength(1)
    expect(broken).toHaveLength(1)
  })

  it('rejects a non-integer textureSize', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ textureSize: 0.5, u: 0, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('целым числом')
  })

  it('rejects a textureSize outside the signed byte range', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ textureSize: 128, size: { x: 0.125, y: 0.125, z: 0.125 }, u: 0, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('не помещается в байт')
  })

  it('rejects a zero textureSize on a textured cube', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ textureSize: 0, u: 0, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('texture: false')
  })

  it('rejects a negative textureSize instead of blessing mirror-by-sign', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ textureSize: -64, size: { x: 0.1, y: 0.1, z: 0.1 }, u: 0, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('зеркальность задаётся флагом mirror')
  })

  it('rejects a mirrored textureSize beyond the negative byte edge', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild({ mirror: true, textureSize: 129, size: { x: 0.12, y: 0.12, z: 0.12 }, u: 0, v: 0 })]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('не помещается в байт')
  })

  it('rejects a per-face UV entry that is not an object', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({ faceUV: { north: null as unknown as CPMFaceUV } }),
      ]),
    ])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('объектом UV-прямоугольника')
  })

  it('treats a cube without size as a zero-size cube instead of crashing', () => {
    const config = makeConfig([
      makeRoot('body', [{ ...makeChild(), size: undefined as unknown as CPMVec3 }]),
    ])

    expect(validatePresetConfig(config)).toEqual([])
  })

  it('rejects a root that no player part ordinal matches', () => {
    const tail = validatePresetConfig(makeConfig([makeRoot('tail')]))
    const cape = validatePresetConfig(makeConfig([makeRoot('cape')]))
    const bareCustom = validatePresetConfig(makeConfig([makeRoot('custom_part')]))

    expect(tail).toHaveLength(1)
    expect(tail[0]).toContain('не сопоставим ванильным частям')
    expect(cape).toHaveLength(1)
    expect(bareCustom).toHaveLength(1)
  })

  it('rejects a duplicate vanilla root as an ambiguous PT.PLAYER bit', () => {
    const config = makeConfig([makeRoot('head'), makeRoot('head')])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('PT.PLAYER')
  })

  it('rejects a dup root that does not reference a vanilla part', () => {
    const config = makeConfig([makeRoot('custom_part', [], { dup: true })])

    const errors = validatePresetConfig(config)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('ванильную часть')
  })
})

describe('maxPresetSkinScale', () => {
  it('derives the format ceiling when every textured cube keeps textureSize 1', () => {
    const config = makeConfig([
      makeRoot('body', [makeChild(), makeChild({ name: 'arm', size: { x: 4, y: 12, z: 4 }, u: 40, v: 16 })]),
    ])

    expect(maxPresetSkinScale(config)).toBe(127)
  })

  it('divides the texSize byte by the densest textured cube', () => {
    const withTs2 = makeConfig([makeRoot('body', [makeChild({ textureSize: 2, size: { x: 8, y: 8, z: 8 }, u: 0, v: 16 })])])
    const withTs15 = makeConfig([makeRoot('body', [makeChild({ textureSize: 15, size: { x: 0.5, y: 0.5, z: 0.5 }, u: 0, v: 0 })])])
    const withTs127 = makeConfig([makeRoot('body', [makeChild({ textureSize: 127, size: { x: 0.125, y: 0.125, z: 0.125 }, u: 0, v: 0 })])])

    expect(maxPresetSkinScale(withTs2)).toBe(63)
    expect(maxPresetSkinScale(withTs15)).toBe(8)
    expect(maxPresetSkinScale(withTs127)).toBe(1)
  })

  it('bounds mirrored density by the negative byte edge instead of the positive one', () => {
    const mirrored = (textureSize: number): CPMConfig =>
      makeConfig([
        makeRoot('body', [makeChild({ mirror: true, textureSize, size: { x: 0.25, y: 0.25, z: 0.25 }, u: 0, v: 0 })]),
      ])
    const plain64 = makeConfig([
      makeRoot('body', [makeChild({ textureSize: 64, size: { x: 0.25, y: 0.25, z: 0.25 }, u: 0, v: 0 })]),
    ])

    expect(maxPresetSkinScale(mirrored(16))).toBe(8)
    expect(maxPresetSkinScale(mirrored(64))).toBe(2)
    expect(maxPresetSkinScale(mirrored(128))).toBe(1)
    expect(maxPresetSkinScale(plain64)).toBe(1)
  })

  it('ignores untextured cubes when deriving the ceiling', () => {
    const config = makeConfig([
      makeRoot('body', [
        makeChild({ texture: false, textureSize: 100 }),
        makeChild({ name: 'plain', size: { x: 4, y: 12, z: 4 }, u: 40, v: 16 }),
      ]),
    ])

    expect(maxPresetSkinScale(config)).toBe(127)
  })

  it('counts nested cube densities', () => {
    const config = makeConfig([
      makeRoot('custom_part', [
        makeChild({
          name: 'outer',
          u: 0,
          v: 0,
          children: [makeChild({ name: 'inner', textureSize: 32, size: { x: 0.25, y: 0.25, z: 0.25 }, u: 0, v: 0 })],
        }),
      ], { customPart: true }),
    ])

    expect(maxPresetSkinScale(config)).toBe(3)
  })
})

describe('validatePresetSkinFit', () => {
  const densePreset = (textureSize: number): CPMConfig =>
    makeConfig([
      makeRoot('body', [makeChild({ textureSize, size: { x: 0.5, y: 0.5, z: 0.5 }, u: 0, v: 0 })]),
    ])

  it('accepts an HD skin within the per-preset ceiling', () => {
    expect(validatePresetSkinFit(densePreset(15), 512, 512)).toEqual([])
  })

  it('accepts a skin exactly at the per-preset ceiling', () => {
    expect(validatePresetSkinFit(densePreset(15), 64 * 8, 64 * 8)).toEqual([])
    expect(validatePresetSkinFit(densePreset(1), 64 * 127, 64 * 127)).toEqual([])
  })

  it('rejects a skin above the per-preset ceiling with the derived limit', () => {
    const errors = validatePresetSkinFit(densePreset(16), 512, 512)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('448×448')
    expect(errors[0]).toContain('S ≤ 7')
  })

  it('accepts an HD skin allowed by the mirrored negative byte edge', () => {
    const mirrored = makeConfig([
      makeRoot('body', [makeChild({ mirror: true, textureSize: 64, size: { x: 0.25, y: 0.25, z: 0.25 }, u: 0, v: 0 })]),
    ])

    expect(validatePresetSkinFit(mirrored, 128, 128)).toEqual([])

    const over = validatePresetSkinFit(mirrored, 192, 192)

    expect(over).toHaveLength(1)
    expect(over[0]).toContain('S ≤ 2')
  })

  it('returns the skin-size error as a validation message', () => {
    const errors = validatePresetSkinFit(densePreset(1), 100, 100)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('кратна')
  })
})

describe('validatePresetPair', () => {
  const pairConfig = (skinType?: 'default' | 'slim'): CPMConfig =>
    makeConfig([makeRoot('body')], skinType === undefined ? {} : { skinType })
  const pairMeta = (skinType: 'slim' | 'classic' | 'both') => ({ name: 'Preset', slug: 'preset', skinType })

  it('requires a slim config for a slim preset', () => {
    expect(validatePresetPair(pairConfig('slim'), pairMeta('slim'))).toEqual([])
    expect(validatePresetPair(pairConfig('default'), pairMeta('slim'))).toHaveLength(1)
    expect(validatePresetPair(pairConfig(undefined), pairMeta('slim'))).toHaveLength(1)
  })

  it('requires a classic config for a classic preset', () => {
    expect(validatePresetPair(pairConfig('default'), pairMeta('classic'))).toEqual([])
    expect(validatePresetPair(pairConfig(undefined), pairMeta('classic'))).toEqual([])
    expect(validatePresetPair(pairConfig('slim'), pairMeta('classic'))).toHaveLength(1)
  })

  it('accepts any config skinType for a both preset and names the offending value', () => {
    expect(validatePresetPair(pairConfig('slim'), pairMeta('both'))).toEqual([])
    expect(validatePresetPair(pairConfig(undefined), pairMeta('both'))).toEqual([])

    const errors = validatePresetPair(pairConfig('slim'), pairMeta('classic'))

    expect(errors[0]).toContain('config.skinType')
  })
})

describe('validatePresetMeta', () => {
  const fullMeta = {
    name: 'Female Body',
    slug: 'female-body',
    skinType: 'both',
    auxRegions: [{ name: 'body-aux', sx: 58, sy: 0, ex: 64, ey: 4 }],
    previewSkin: 'preview.png',
  }

  it('accepts a complete meta.json', () => {
    expect(validatePresetMeta(fullMeta)).toEqual([])
  })

  it('accepts a minimal meta.json without optional fields', () => {
    expect(validatePresetMeta({ name: 'Slim Arms', slug: 'slim-arms', skinType: 'slim' })).toEqual([])
  })

  it('rejects a non-object payload', () => {
    expect(validatePresetMeta(null)).toHaveLength(1)
    expect(validatePresetMeta([fullMeta])).toHaveLength(1)
    expect(validatePresetMeta('preset')).toHaveLength(1)
  })

  it('rejects a missing or empty name', () => {
    expect(validatePresetMeta({ slug: 'x', skinType: 'slim' })).toHaveLength(1)
    expect(validatePresetMeta({ name: '  ', slug: 'x', skinType: 'slim' })).toHaveLength(1)
  })

  it('rejects a slug outside kebab-case', () => {
    const errors = validatePresetMeta({ name: 'Preset', slug: 'Female Body!', skinType: 'both' })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('kebab-case')
  })

  it('rejects an unknown skinType', () => {
    const errors = validatePresetMeta({ name: 'Preset', slug: 'preset', skinType: 'alex' })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('slim, classic или both')
  })

  it('rejects auxRegions that are not an array', () => {
    const errors = validatePresetMeta({ ...fullMeta, auxRegions: { sx: 0 } })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('массивом')
  })

  it('rejects an aux region outside the logical atlas', () => {
    const errors = validatePresetMeta({
      ...fullMeta,
      auxRegions: [{ name: 'over', sx: 58, sy: 0, ex: 70, ey: 4 }],
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('выходит за логический атлас')
  })

  it('rejects a degenerate aux region', () => {
    const errors = validatePresetMeta({
      ...fullMeta,
      auxRegions: [{ name: 'flat', sx: 10, sy: 0, ex: 10, ey: 4 }],
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('непустую область')
  })

  it('rejects an aux region without a name', () => {
    const errors = validatePresetMeta({
      ...fullMeta,
      auxRegions: [{ sx: 0, sy: 0, ex: 8, ey: 8 }],
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Имя aux-зоны')
  })

  it('rejects a non-string previewSkin', () => {
    const errors = validatePresetMeta({ ...fullMeta, previewSkin: 123 })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('previewSkin')
  })

  it('rejects a previewSkin carrying a path instead of a package-local file name', () => {
    const nested = validatePresetMeta({ ...fullMeta, previewSkin: 'skins/preview.png' })
    const traversal = validatePresetMeta({ ...fullMeta, previewSkin: '..\\preview.png' })

    expect(nested).toHaveLength(1)
    expect(nested[0]).toContain('именем файла внутри пакета')
    expect(traversal).toHaveLength(1)
  })
})
