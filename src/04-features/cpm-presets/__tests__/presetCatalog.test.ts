import { describe, expect, it, vi } from 'vitest'
import { reportError } from '@/06-shared'
import { builtinPresetSource } from '../builtinPresetSource'
import { combinePresetSources, type PresetCatalogEntry, type PresetCatalogSource } from '../presetCatalog'
import { serverPresetSource, type PresetCatalogTransport } from '../serverPresetSource'

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reportError: vi.fn(),
}))

const entry = (slug: string): PresetCatalogEntry => ({
  slug,
  name: slug,
  skinType: 'both',
  previewUrl: null,
})

const sourceWith = (slugs: string[], pkgBytes = new Uint8Array([1])): PresetCatalogSource & {
  list: ReturnType<typeof vi.fn>
  fetch: ReturnType<typeof vi.fn>
} => ({
  list: vi.fn().mockResolvedValue(slugs.map((slug) => entry(slug))),
  fetch: vi.fn().mockImplementation(async (slug: string): Promise<unknown> =>
    slugs.includes(slug) ? { projectData: pkgBytes, metaData: pkgBytes, previewSkin: null } : Promise.reject(new Error(`Пресет "${slug}" недоступен`))
  ),
})

describe('combinePresetSources', () => {
  it('объединяет списки источников по порядку', async () => {
    const catalog = combinePresetSources(sourceWith(['female-body']), sourceWith(['hero', 'mage']))

    const entries = await catalog.list()
    expect(entries.map((item) => item.slug)).toEqual(['female-body', 'hero', 'mage'])
  })

  it('маршрутизирует fetch к источнику, у которого есть пресет', async () => {
    const builtin = sourceWith(['female-body'])
    const server = sourceWith(['hero'])
    const catalog = combinePresetSources(builtin, server)

    await expect(catalog.fetch('hero')).resolves.toBeDefined()
    expect(builtin.fetch).toHaveBeenCalledWith('hero')
    expect(server.fetch).toHaveBeenCalledWith('hero')
  })

  it('выбрасывает последнюю ошибку, когда пресета нет ни в одном источнике', async () => {
    const first = sourceWith([])
    const second = sourceWith([])
    first.fetch.mockRejectedValue(new Error('нет в первом'))
    second.fetch.mockRejectedValue(new Error('нет во втором'))
    const catalog = combinePresetSources(first, second)

    await expect(catalog.fetch('ghost')).rejects.toThrow('нет во втором')
  })

  it('офлайн: при недоступном сервере каталог показывает только builtin без ошибок', async () => {
    const transport: PresetCatalogTransport = {
      fetchManifest: vi.fn().mockRejectedValue(new Error('сеть недоступна')),
      fetchBytes: vi.fn(),
    }
    const catalog = combinePresetSources(builtinPresetSource, serverPresetSource(transport, {
      read: (): Promise<null> => Promise.resolve(null),
      write: (): Promise<void> => Promise.resolve(),
    }))

    const entries = await catalog.list()

    expect(entries.map((item) => item.slug)).toEqual(['female-body'])
    expect(reportError).toHaveBeenCalled()
  })

  it('встроенный и серверный пресеты вместе выбираются из общего каталога', async () => {
    const transport: PresetCatalogTransport = {
      fetchManifest: vi.fn().mockResolvedValue({
        version: 1,
        presets: [{
          slug: 'hero',
          name: 'Hero',
          skinType: 'slim',
          hash: 'h1',
          projectUrl: 'p.zip',
          metaUrl: 'm.json',
          previewUrl: null,
        }],
      }),
      fetchBytes: vi.fn().mockResolvedValue(new Uint8Array([2])),
    }
    const catalog = combinePresetSources(builtinPresetSource, serverPresetSource(transport, {
      read: (): Promise<null> => Promise.resolve(null),
      write: (): Promise<void> => Promise.resolve(),
    }))

    const entries = await catalog.list()
    expect(entries.map((item) => item.slug)).toEqual(['female-body', 'hero'])

    const builtinPkg = await catalog.fetch('female-body')
    expect(builtinPkg.projectData.length).toBeGreaterThan(0)

    const serverPkg = await catalog.fetch('hero')
    expect(serverPkg.projectData).toEqual(new Uint8Array([2]))
  })
})
