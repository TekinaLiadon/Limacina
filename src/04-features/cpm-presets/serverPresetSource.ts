import { reportError } from '@/06-shared'
import type { PresetCatalogEntry, PresetCatalogSource, PresetPackageData } from './presetCatalog'
import { parsePresetManifest, type PresetManifest } from './presetManifest'

export interface PresetCatalogTransport {
  fetchManifest(): Promise<unknown>
  fetchBytes(url: string): Promise<Uint8Array>
}

export interface PresetPackageCache {
  read(slug: string, hash: string): Promise<PresetPackageData | null>
  write(slug: string, hash: string, pkg: PresetPackageData): Promise<void>
}

const MANIFEST_UNAVAILABLE_MESSAGE = 'Каталог пресетов сервера недоступен'
const CACHE_READ_MESSAGE = 'Не удалось прочитать кэш пресета'
const CACHE_WRITE_MESSAGE = 'Не удалось сохранить пресет в кэш'

export function serverPresetSource(transport: PresetCatalogTransport, cache: PresetPackageCache): PresetCatalogSource {
  let manifest: PresetManifest | null = null

  const list = async (): Promise<PresetCatalogEntry[]> => {
    try {
      manifest = parsePresetManifest(await transport.fetchManifest())
    } catch (e: unknown) {
      manifest = null
      reportError(MANIFEST_UNAVAILABLE_MESSAGE, e)
      return []
    }
    return manifest.presets.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      skinType: entry.skinType,
      previewUrl: entry.previewUrl,
    }))
  }

  const fetch = async (slug: string): Promise<PresetPackageData> => {
    const entry = manifest?.presets.find((item) => item.slug === slug)
    if (!entry) throw new Error(`Пресет "${slug}" недоступен`)

    try {
      const cached = await cache.read(slug, entry.hash)
      if (cached !== null) return cached
    } catch (e: unknown) {
      reportError(CACHE_READ_MESSAGE, e)
    }

    const [projectData, metaData, previewSkin] = await Promise.all([
      transport.fetchBytes(entry.projectUrl),
      transport.fetchBytes(entry.metaUrl),
      entry.previewUrl === null ? Promise.resolve(null) : transport.fetchBytes(entry.previewUrl),
    ])
    const pkg: PresetPackageData = { projectData, metaData, previewSkin }

    try {
      await cache.write(slug, entry.hash, pkg)
    } catch (e: unknown) {
      reportError(CACHE_WRITE_MESSAGE, e)
    }
    return pkg
  }

  return { list, fetch }
}
