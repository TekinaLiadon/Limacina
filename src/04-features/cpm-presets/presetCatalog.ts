import type { PresetSkinType } from './presetTypes'

export interface PresetCatalogEntry {
  slug: string
  name: string
  skinType: PresetSkinType
  previewUrl: string | null
}

export interface PresetPackageData {
  projectData: Uint8Array
  metaData: Uint8Array
  previewSkin: Uint8Array | null
}

export interface PresetCatalogSource {
  list(): Promise<PresetCatalogEntry[]>
  fetch(slug: string): Promise<PresetPackageData>
}

export const emptyPresetCatalog: PresetCatalogSource = {
  list: (): Promise<PresetCatalogEntry[]> => Promise.resolve([]),
  fetch: (slug: string): Promise<PresetPackageData> =>
    Promise.reject(new Error(`Пресет "${slug}" недоступен`)),
}

export function combinePresetSources(...sources: PresetCatalogSource[]): PresetCatalogSource {
  return {
    list: async (): Promise<PresetCatalogEntry[]> => {
      const lists = await Promise.all(sources.map((source) => source.list()))
      return lists.flat()
    },
    fetch: async (slug: string): Promise<PresetPackageData> => {
      let lastError: unknown = null
      for (const source of sources) {
        try {
          return await source.fetch(slug)
        } catch (e: unknown) {
          lastError = e
        }
      }
      throw lastError ?? new Error(`Пресет "${slug}" недоступен`)
    },
  }
}
