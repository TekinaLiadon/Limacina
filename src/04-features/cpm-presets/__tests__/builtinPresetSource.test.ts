import { describe, expect, it } from 'vitest'
import { builtinPresetSource } from '../builtinPresetSource'
import { parsePresetProject } from '../presetLoader'
import { maxPresetSkinScale, validatePresetSkinFit } from '../presetValidator'

describe('builtinPresetSource', () => {
  it('показывает стартовый пресет female-body с превью', async () => {
    const entries = await builtinPresetSource.list()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.slug).toBe('female-body')
    expect(entries[0]?.name).toBe('Женское тело')
    expect(entries[0]?.skinType).toBe('both')
    expect(entries[0]?.previewUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('отдаёт пакет, проходящий полный разбор пресета', async () => {
    const pkg = await builtinPresetSource.fetch('female-body')

    const parsed = await parsePresetProject(pkg.projectData, pkg.metaData)
    expect(parsed.meta.slug).toBe('female-body')
    expect(parsed.meta.skinType).toBe('both')
    expect(parsed.config.elements.length).toBeGreaterThan(0)
  })

  it('поддерживает HD-скины до 512×512', async () => {
    const pkg = await builtinPresetSource.fetch('female-body')
    const parsed = await parsePresetProject(pkg.projectData, pkg.metaData)

    expect(maxPresetSkinScale(parsed.config)).toBeGreaterThanOrEqual(8)
    expect(validatePresetSkinFit(parsed.config, 512, 512)).toEqual([])
  })

  it('объявляет aux-зону свободной области атласа', async () => {
    const pkg = await builtinPresetSource.fetch('female-body')
    const parsed = await parsePresetProject(pkg.projectData, pkg.metaData)

    expect(parsed.meta.auxRegions).toEqual([
      { name: 'body-aux', sx: 58, sy: 0, ex: 64, ey: 4 },
      { name: 'body-jacket', sx: 16, sy: 32, ex: 40, ey: 48 },
    ])
  })

  it('отдаёт пресет без анимаций, пока исходная модель их не содержит', async () => {
    const pkg = await builtinPresetSource.fetch('female-body')

    const parsed = await parsePresetProject(pkg.projectData, pkg.metaData)
    expect(parsed.animations).toEqual([])
  })

  it('содержит PNG-превью для показа до загрузки своего скина', async () => {
    const pkg = await builtinPresetSource.fetch('female-body')

    expect(pkg.previewSkin).not.toBeNull()
    expect(Array.from(pkg.previewSkin?.slice(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('отвергает неизвестный slug', async () => {
    await expect(builtinPresetSource.fetch('hero')).rejects.toThrow('Пресет "hero" недоступен')
  })
})
