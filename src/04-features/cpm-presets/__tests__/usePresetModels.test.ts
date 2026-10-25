import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import JSZip from 'jszip'
import type { CPMConfig } from '@/05-entities'
import type { PresetCatalogEntry, PresetCatalogSource } from '../presetCatalog'
import { usePresetModels } from '../usePresetModels'
import { withSetup } from '@/test-support/withSetup'

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

const metaJson = JSON.stringify({ name: 'Female Body', slug: 'female-body', skinType: 'both' })

const entry = (slug: string): PresetCatalogEntry => ({
  slug,
  name: slug,
  skinType: 'both',
  previewUrl: null,
})

async function buildPackage(slug: string): Promise<{ projectData: Uint8Array; metaData: Uint8Array; previewSkin: Uint8Array | null }> {
  const zip = new JSZip()
  zip.file('config.json', JSON.stringify(config))
  return {
    projectData: await zip.generateAsync({ type: 'uint8array' }),
    metaData: new TextEncoder().encode(JSON.stringify({ ...JSON.parse(metaJson), slug })),
    previewSkin: new Uint8Array([9, 9]),
  }
}

function setup(source: PresetCatalogSource): ReturnType<typeof usePresetModels> {
  const { result } = withSetup((): ReturnType<typeof usePresetModels> => usePresetModels(source))
  return result
}

describe('usePresetModels', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the catalog on init', async () => {
    const source: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([entry('female-body')]),
      fetch: vi.fn(),
    }

    const models = setup(source)
    await flushPromises()

    expect(models.isListLoading.value).toBe(false)
    expect(models.listError.value).toBe('')
    expect(models.entries.value.map((item) => item.slug)).toEqual(['female-body'])
  })

  it('surfaces the catalog failure and recovers through retry', async () => {
    const source: PresetCatalogSource = {
      list: vi.fn()
        .mockRejectedValueOnce(new Error('сеть недоступна'))
        .mockResolvedValueOnce([entry('female-body')]),
      fetch: vi.fn(),
    }

    const models = setup(source)
    await flushPromises()

    expect(models.listError.value).toContain('сеть недоступна')
    expect(models.entries.value).toEqual([])

    await models.loadCatalog()

    expect(models.listError.value).toBe('')
    expect(models.entries.value).toHaveLength(1)
  })

  it('selects a preset and keeps its preview skin bytes', async () => {
    const source: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([]),
      fetch: vi.fn().mockResolvedValue(await buildPackage('female-body')),
    }

    const models = setup(source)
    await flushPromises()
    await models.selectPreset('female-body')

    expect(models.selectedSlug.value).toBe('female-body')
    expect(models.preset.value?.meta.slug).toBe('female-body')
    expect(models.preset.value?.config).toEqual(config)
    expect(models.previewSkinBytes.value).toEqual(new Uint8Array([9, 9]))
    expect(models.presetError.value).toBe('')
    expect(models.isPresetLoading.value).toBe(false)
  })

  it('keeps the previous preset and reports the failed slug when fetching breaks', async () => {
    const source: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([entry('female-body'), entry('hero')]),
      fetch: vi.fn()
        .mockResolvedValueOnce(await buildPackage('female-body'))
        .mockRejectedValueOnce(new Error('битый пакет')),
    }

    const models = setup(source)
    await flushPromises()
    await models.selectPreset('female-body')
    await models.selectPreset('hero')

    expect(models.preset.value?.meta.slug).toBe('female-body')
    expect(models.selectedSlug.value).toBe('female-body')
    expect(models.presetError.value).toContain('битый пакет')
  })

  it('retries the failed selection', async () => {
    const source: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([entry('female-body')]),
      fetch: vi.fn()
        .mockRejectedValueOnce(new Error('битый пакет'))
        .mockResolvedValueOnce(await buildPackage('female-body')),
    }

    const models = setup(source)
    await flushPromises()
    await models.selectPreset('female-body')
    await models.retryPreset()

    expect(models.presetError.value).toBe('')
    expect(models.selectedSlug.value).toBe('female-body')
  })

  it('ignores a stale selection that resolves after a newer one', async () => {
    let releaseSlow: (value: { projectData: Uint8Array; metaData: Uint8Array; previewSkin: Uint8Array | null }) => void = () => {}
    const slowPackage = new Promise<{ projectData: Uint8Array; metaData: Uint8Array; previewSkin: Uint8Array | null }>((resolve) => {
      releaseSlow = resolve
    })
    const source: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([]),
      fetch: vi.fn()
        .mockImplementationOnce(() => slowPackage)
        .mockImplementationOnce(() => buildPackage('hero')),
    }

    const models = setup(source)
    await flushPromises()
    const first = models.selectPreset('female-body')
    await models.selectPreset('hero')
    releaseSlow(await buildPackage('female-body'))
    await first

    expect(models.selectedSlug.value).toBe('hero')
    expect(models.preset.value?.meta.slug).toBe('hero')
  })

  it('clears the selection', async () => {
    const source: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([]),
      fetch: vi.fn().mockResolvedValue(await buildPackage('female-body')),
    }

    const models = setup(source)
    await flushPromises()
    await models.selectPreset('female-body')
    models.clearSelection()

    expect(models.selectedSlug.value).toBeNull()
    expect(models.preset.value).toBeNull()
    expect(models.previewSkinBytes.value).toBeNull()
    expect(models.presetError.value).toBe('')
  })

  it('parses the package through the preset loader contract', async () => {
    const zip = new JSZip()
    zip.file('config.json', JSON.stringify(config))
    zip.file('skin.png', new Uint8Array([1, 2, 3]))
    const broken: PresetCatalogSource = {
      list: vi.fn().mockResolvedValue([]),
      fetch: vi.fn().mockResolvedValue({
        projectData: await zip.generateAsync({ type: 'uint8array' }),
        metaData: new TextEncoder().encode(metaJson),
        previewSkin: null,
      }),
    }

    const models = setup(broken)
    await flushPromises()
    await models.selectPreset('female-body')

    expect(models.preset.value).toBeNull()
    expect(models.presetError.value).toContain('skin.png')
  })
})
