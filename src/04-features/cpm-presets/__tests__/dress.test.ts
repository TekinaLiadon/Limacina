import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { CPMConfig, SkinModelMode } from '@/05-entities'
import { hasPngSignature } from '@/06-shared'
import { cpmProjectToBytes, cpmProjectToLinkBase64 } from '@/04-features/cpm-convert/cpmProjectExporter'
import { compose, presetSkinTypeWarning } from '../dress'
import { decodePngSkin } from '../skinPng'
import { scaleSkinLayout } from '../skinScale'
import { validateSkin } from '../skinValidate'

const PRESET_CONFIG: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  skinType: 'default',
  elements: [
    {
      id: 'body',
      name: 'body',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children: [
        {
          name: 'torso',
          size: { x: 8, y: 12, z: 4 },
          offset: { x: -4, y: 0, z: -2 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          u: 16,
          v: 16,
          textureSize: 1,
        },
      ],
    },
  ],
}

function patternImage(width: number): { width: number, height: number, rgba: Uint8Array } {
  const rgba = new Uint8Array(width * width * 4)
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      rgba[offset] = (x * 3) % 256
      rgba[offset + 1] = (y * 7) % 256
      rgba[offset + 2] = 90
      rgba[offset + 3] = 255
    }
  }
  return { width, height: width, rgba }
}

async function buildProjectZip(config: CPMConfig, skinPng: Uint8Array): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('config.json', JSON.stringify(config))
  zip.file('skin.png', skinPng)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('compose', () => {
  it('rewrites config.skinType from the user skin model', async () => {
    const scaled = scaleSkinLayout(PRESET_CONFIG, 8)

    const slim = await compose(scaled, patternImage(512), 'slim')
    const classic = await compose(scaled, patternImage(64), 'classic')

    expect(slim.config.skinType).toBe('slim')
    expect(classic.config.skinType).toBe('default')
    expect(scaled.skinType).toBe('default')
  })

  it('produces a PNG matching the scaled skin dimensions', async () => {
    const image = patternImage(512)

    const dressed = await compose(scaleSkinLayout(PRESET_CONFIG, 8), image, 'classic')

    expect(hasPngSignature(dressed.skinPng)).toBe(true)
    expect(validateSkin(dressed.skinPng).errors).toEqual([])
    expect(validateSkin(dressed.skinPng).scale).toBe(8)

    const decoded = await decodePngSkin(dressed.skinPng)
    expect(decoded.width).toBe(512)
    expect(Array.from(decoded.rgba)).toEqual(Array.from(image.rgba))
  })

  it('feeds the existing exporter without changes', async () => {
    const dressed = await compose(scaleSkinLayout(PRESET_CONFIG, 8), patternImage(512), 'slim')

    const project = await buildProjectZip(dressed.config, dressed.skinPng)
    const installed = await cpmProjectToBytes(project)
    expect(installed[0]).toBe(0x53)
    expect(installed.byteLength).toBeGreaterThan(100)

    const link = await cpmProjectToLinkBase64(project)
    expect(link.length).toBeGreaterThan(0)
    expect(atob(link).charCodeAt(0)).toBe(0x53)
  })
})

describe('presetSkinTypeWarning', () => {
  it('never warns for a both preset', () => {
    expect(presetSkinTypeWarning('both', 'slim')).toBeNull()
    expect(presetSkinTypeWarning('both', 'classic')).toBeNull()
  })

  it('stays silent when the skin model matches', () => {
    expect(presetSkinTypeWarning('slim', 'slim')).toBeNull()
    expect(presetSkinTypeWarning('classic', 'classic')).toBeNull()
  })

  it('warns on a mismatch without blocking', () => {
    const mode: SkinModelMode = 'slim'
    const classicWarning = presetSkinTypeWarning('classic', mode)
    const slimWarning = presetSkinTypeWarning('slim', 'classic')

    expect(classicWarning).toContain('classic')
    expect(classicWarning).toContain('slim')
    expect(slimWarning).toContain('slim')
    expect(slimWarning).toContain('classic')
  })
})
