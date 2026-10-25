import { describe, expect, it } from 'vitest'
import { parsePresetManifest, PRESET_MANIFEST_VERSION, type PresetManifestEntry } from '../presetManifest'

const entry = (overrides: Record<string, unknown> = {}): PresetManifestEntry =>
  ({
    slug: 'female-body',
    name: 'Женское тело',
    skinType: 'both',
    hash: 'a1b2c3',
    projectUrl: 'presets/female-body/project.zip',
    metaUrl: 'presets/female-body/meta.json',
    previewUrl: null,
    ...overrides,
  }) as PresetManifestEntry

describe('parsePresetManifest', () => {
  it('разбирает валидный манифест', () => {
    const manifest = parsePresetManifest({
      version: PRESET_MANIFEST_VERSION,
      presets: [entry(), entry({ slug: 'hero', name: 'Hero', hash: 'd4e5f6' })],
    })

    expect(manifest.version).toBe(PRESET_MANIFEST_VERSION)
    expect(manifest.presets.map((item) => item.slug)).toEqual(['female-body', 'hero'])
    expect(manifest.presets[0]?.previewUrl).toBeNull()
  })

  it('допускает previewUrl строкой', () => {
    const manifest = parsePresetManifest({
      version: PRESET_MANIFEST_VERSION,
      presets: [entry({ previewUrl: 'presets/female-body/preview.png' })],
    })

    expect(manifest.presets[0]?.previewUrl).toBe('presets/female-body/preview.png')
  })

  it('отвергает не-объект', () => {
    expect(() => parsePresetManifest(null)).toThrow('Некорректный манифест каталога пресетов')
    expect(() => parsePresetManifest('manifest')).toThrow('Некорректный манифест каталога пресетов')
    expect(() => parsePresetManifest([])).toThrow('Некорректный манифест каталога пресетов')
  })

  it('отвергает неподдерживаемую версию', () => {
    expect(() => parsePresetManifest({ version: 2, presets: [] })).toThrow('поддерживаемая версия 2')
    expect(() => parsePresetManifest({ presets: [] })).toThrow('поддерживаемая версия undefined')
  })

  it('отвергает манифест без массива presets', () => {
    expect(() => parsePresetManifest({ version: PRESET_MANIFEST_VERSION })).toThrow('presets должен быть массивом')
  })

  it('отвергает запись с полями meta, не прошедшими контракт пресета', () => {
    expect(() => parsePresetManifest({ version: 1, presets: [entry({ slug: 'Female Body' })] })).toThrow('slug')
    expect(() => parsePresetManifest({ version: 1, presets: [entry({ name: '' })] })).toThrow('name')
    expect(() => parsePresetManifest({ version: 1, presets: [entry({ skinType: 'slim-classic' })] })).toThrow('skinType')
  })

  it('отвергает запись без hash или адресов файлов', () => {
    expect(() => parsePresetManifest({ version: 1, presets: [entry({ hash: '' })] })).toThrow('hash')
    expect(() => parsePresetManifest({ version: 1, presets: [entry({ projectUrl: '' })] })).toThrow('projectUrl')
    expect(() => parsePresetManifest({ version: 1, presets: [entry({ metaUrl: '' })] })).toThrow('metaUrl')
  })

  it('отвергает дублирующийся slug', () => {
    expect(() =>
      parsePresetManifest({ version: 1, presets: [entry(), entry({ hash: 'other' })] })
    ).toThrow('дублирующийся slug "female-body"')
  })
})
