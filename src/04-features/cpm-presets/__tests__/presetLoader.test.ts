import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { parsePresetProject } from '../presetLoader'
import type { CPMConfig } from '@/05-entities'

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
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
        },
      ],
    },
  ],
}

const metaJson = JSON.stringify({
  name: 'Female Body',
  slug: 'female-body',
  skinType: 'both',
  auxRegions: [{ name: 'body-aux', sx: 58, sy: 0, ex: 64, ey: 4 }],
  previewSkin: 'preview.png',
})

const skinBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

async function buildZip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

const metaBytes = (json: string = metaJson): Uint8Array => new TextEncoder().encode(json)

describe('parsePresetProject', () => {
  it('returns the validated config and meta pair with animations', async () => {
    const projectData = await buildZip({
      'config.json': JSON.stringify(config),
      'animations/g_pulse.json': JSON.stringify({ name: 'Pulse' }),
    })

    const preset = await parsePresetProject(projectData, metaBytes())

    expect(preset.config).toEqual(config)
    expect(preset.meta).toEqual(JSON.parse(metaJson))
    expect(preset.animations).toHaveLength(1)
    expect(preset.animations[0]?.name).toBe('Pulse')
    expect(preset.animEnc).toBeNull()
  })

  it('rejects malformed meta.json', async () => {
    const projectData = await buildZip({ 'config.json': JSON.stringify(config) })

    await expect(parsePresetProject(projectData, metaBytes('{ broken'))).rejects.toThrow(
      'Некорректный meta.json пресета',
    )
  })

  it('rejects a meta.json with contract violations', async () => {
    const projectData = await buildZip({ 'config.json': JSON.stringify(config) })
    const brokenMeta = metaBytes(JSON.stringify({ name: 'Preset', slug: 'Female Body!', skinType: 'both' }))

    await expect(parsePresetProject(projectData, brokenMeta)).rejects.toThrow('kebab-case')
  })

  it('rejects a preset config whose UV leaves the logical atlas', async () => {
    const overflow: CPMConfig = {
      ...config,
      elements: [{
        ...config.elements[0]!,
        children: [{ ...config.elements[0]!.children![0]!, u: 48, v: 16 }],
      }],
    }
    const projectData = await buildZip({ 'config.json': JSON.stringify(overflow) })

    await expect(parsePresetProject(projectData, metaBytes())).rejects.toThrow('выходит за логический атлас')
  })

  it('rejects a contradictory skinType pair', async () => {
    const projectData = await buildZip({
      'config.json': JSON.stringify({ ...config, skinType: 'slim' }),
    })
    const classicMeta = metaBytes(JSON.stringify({ name: 'Preset', slug: 'preset', skinType: 'classic' }))

    await expect(parsePresetProject(projectData, classicMeta)).rejects.toThrow('config.skinType')
  })

  it('rejects a preset project that embeds skin.png', async () => {
    const projectData = await buildZip({
      'config.json': JSON.stringify(config),
      'skin.png': skinBytes,
    })

    await expect(parsePresetProject(projectData, metaBytes())).rejects.toThrow(
      'Пресет не должен содержать skin.png',
    )
  })
})
