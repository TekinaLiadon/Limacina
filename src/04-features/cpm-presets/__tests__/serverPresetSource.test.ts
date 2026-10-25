import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reportError } from '@/06-shared'
import type { PresetPackageData } from '../presetCatalog'
import type { PresetManifestEntry } from '../presetManifest'
import { serverPresetSource, type PresetPackageCache } from '../serverPresetSource'

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reportError: vi.fn(),
}))

const manifestEntry = (overrides: Partial<PresetManifestEntry> = {}): PresetManifestEntry => ({
  slug: 'female-body',
  name: 'Женское тело',
  skinType: 'both',
  hash: 'h1',
  projectUrl: 'presets/female-body/project.zip',
  metaUrl: 'presets/female-body/meta.json',
  previewUrl: null,
  ...overrides,
})

const makeCache = (): PresetPackageCache & { store: Map<string, PresetPackageData> } => {
  const store = new Map<string, PresetPackageData>()
  return {
    store,
    read: (slug: string, hash: string): Promise<PresetPackageData | null> =>
      Promise.resolve(store.get(`${slug}@${hash}`) ?? null),
    write: (slug: string, hash: string, data: PresetPackageData): Promise<void> => {
      store.set(`${slug}@${hash}`, data)
      return Promise.resolve()
    },
  }
}

const makeTransport = () => ({
  fetchManifest: vi.fn<() => Promise<unknown>>(),
  fetchBytes: vi.fn<(url: string) => Promise<Uint8Array>>(),
})

const manifestWith = (entry: PresetManifestEntry): unknown => ({ version: 1, presets: [entry] })

beforeEach(() => {
  vi.mocked(reportError).mockClear()
})

describe('serverPresetSource', () => {
  it('показывает записи манифеста', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(
      manifestWith(manifestEntry({ previewUrl: 'presets/female-body/preview.png' }))
    )
    const source = serverPresetSource(transport, makeCache())

    const entries = await source.list()
    expect(entries).toEqual([
      {
        slug: 'female-body',
        name: 'Женское тело',
        skinType: 'both',
        previewUrl: 'presets/female-body/preview.png',
      },
    ])
  })

  it('деградирует до пустого каталога при обрыве сети на манифесте', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockRejectedValue(new Error('сеть недоступна'))
    const source = serverPresetSource(transport, makeCache())

    await expect(source.list()).resolves.toEqual([])
    expect(reportError).toHaveBeenCalled()
  })

  it('деградирует до пустого каталога при битом манифесте', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue({ version: 99, presets: [] })
    const source = serverPresetSource(transport, makeCache())

    await expect(source.list()).resolves.toEqual([])
    expect(reportError).toHaveBeenCalled()
  })

  it('отвергает fetch неизвестного slug', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(manifestWith(manifestEntry()))
    const source = serverPresetSource(transport, makeCache())
    await source.list()

    await expect(source.fetch('hero')).rejects.toThrow('Пресет "hero" недоступен')
    expect(transport.fetchBytes).not.toHaveBeenCalled()
  })

  it('скачивает файлы пакета и кладёт их в кэш по slug+hash', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(manifestWith(manifestEntry()))
    transport.fetchBytes.mockImplementation(async (url: string): Promise<Uint8Array> =>
      new TextEncoder().encode(`bytes of ${url}`)
    )
    const cache = makeCache()
    const source = serverPresetSource(transport, cache)
    await source.list()

    const loaded = await source.fetch('female-body')

    expect(transport.fetchBytes.mock.calls.map(([url]) => url)).toEqual([
      'presets/female-body/project.zip',
      'presets/female-body/meta.json',
    ])
    expect(loaded).toEqual(cache.store.get('female-body@h1'))
  })

  it('скачивает превью, когда манифест его объявляет', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(
      manifestWith(manifestEntry({ previewUrl: 'presets/female-body/preview.png' }))
    )
    transport.fetchBytes.mockImplementation(async (url: string): Promise<Uint8Array> =>
      new TextEncoder().encode(url)
    )
    const source = serverPresetSource(transport, makeCache())
    await source.list()

    const loaded = await source.fetch('female-body')

    expect(transport.fetchBytes).toHaveBeenCalledTimes(3)
    expect(new TextDecoder().decode(loaded.previewSkin ?? new Uint8Array())).toBe('presets/female-body/preview.png')
  })

  it('отдаёт пакет из кэша без обращения к сети при повторном выборе', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(manifestWith(manifestEntry()))
    transport.fetchBytes.mockResolvedValue(new Uint8Array([1]))
    const source = serverPresetSource(transport, makeCache())
    await source.list()
    await source.fetch('female-body')

    transport.fetchBytes.mockClear()
    await source.fetch('female-body')

    expect(transport.fetchBytes).not.toHaveBeenCalled()
  })

  it('переживает отказ чтения кэша: пакет скачивается заново', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(manifestWith(manifestEntry()))
    transport.fetchBytes.mockResolvedValue(new Uint8Array([7]))
    const cache = makeCache()
    cache.read = vi.fn().mockRejectedValue(new Error('диск недоступен'))
    const source = serverPresetSource(transport, cache)
    await source.list()

    const loaded = await source.fetch('female-body')

    expect(loaded).toEqual({
      projectData: new Uint8Array([7]),
      metaData: new Uint8Array([7]),
      previewSkin: null,
    })
    expect(reportError).toHaveBeenCalled()
  })

  it('переживает отказ записи кэша: пакет всё равно возвращается', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(manifestWith(manifestEntry()))
    transport.fetchBytes.mockResolvedValue(new Uint8Array([9]))
    const cache = makeCache()
    cache.write = vi.fn().mockRejectedValue(new Error('диск переполнен'))
    const source = serverPresetSource(transport, cache)
    await source.list()

    const loaded = await source.fetch('female-body')

    expect(loaded.projectData).toEqual(new Uint8Array([9]))
    expect(reportError).toHaveBeenCalled()
  })

  it('версионирование: смена hash ведёт к новому скачиванию и новой записи кэша', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValueOnce(manifestWith(manifestEntry({ hash: 'h1' })))
    transport.fetchBytes.mockResolvedValueOnce(new Uint8Array([1])).mockResolvedValueOnce(new Uint8Array([1]))
    const cache = makeCache()
    const source = serverPresetSource(transport, cache)
    await source.list()
    await source.fetch('female-body')
    expect(cache.store.has('female-body@h1')).toBe(true)

    transport.fetchManifest.mockResolvedValueOnce(manifestWith(manifestEntry({ hash: 'h2' })))
    transport.fetchBytes.mockResolvedValue(new Uint8Array([2]))
    await source.list()
    const updated = await source.fetch('female-body')

    expect(updated.projectData).toEqual(new Uint8Array([2]))
    expect(cache.store.has('female-body@h2')).toBe(true)
    expect(cache.store.has('female-body@h1')).toBe(true)
  })

  it('обрыв сети при скачивании пакета прокидывает ошибку выбора', async () => {
    const transport = makeTransport()
    transport.fetchManifest.mockResolvedValue(manifestWith(manifestEntry()))
    transport.fetchBytes.mockRejectedValue(new Error('обрыв соединения'))
    const source = serverPresetSource(transport, makeCache())
    await source.list()

    await expect(source.fetch('female-body')).rejects.toThrow('обрыв соединения')
  })
})
