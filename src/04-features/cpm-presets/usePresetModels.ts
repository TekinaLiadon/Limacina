import { ref, shallowRef, onScopeDispose } from 'vue'
import { reportError, useAsyncRaceGuard } from '@/06-shared'
import { getErrorMessage } from '@/06-shared/api'
import { emptyPresetCatalog, type PresetCatalogEntry, type PresetCatalogSource } from './presetCatalog'
import { parsePresetProject, type ParsedPreset } from './presetLoader'

const CATALOG_LOAD_ERROR = 'Не удалось загрузить каталог моделей'

export function usePresetModels(source: PresetCatalogSource = emptyPresetCatalog) {
  const entries = shallowRef<PresetCatalogEntry[]>([])
  const isListLoading = ref<boolean>(false)
  const listError = ref<string>('')
  const selectedSlug = ref<string | null>(null)
  const preset = shallowRef<ParsedPreset | null>(null)
  const previewSkinBytes = shallowRef<Uint8Array | null>(null)
  const isPresetLoading = ref<boolean>(false)
  const presetError = ref<string>('')
  const failedSlug = ref<string | null>(null)

  const listGuard = useAsyncRaceGuard()
  const selectGuard = useAsyncRaceGuard()

  const loadCatalog = async (): Promise<void> => {
    const generation = listGuard.next()
    isListLoading.value = true
    listError.value = ''
    try {
      const loaded = await source.list()
      if (!listGuard.isCurrent(generation)) return
      entries.value = loaded
    } catch (e: unknown) {
      if (!listGuard.isCurrent(generation)) return
      reportError(CATALOG_LOAD_ERROR, e)
      listError.value = `${CATALOG_LOAD_ERROR}: ${getErrorMessage(e)}`
    } finally {
      if (listGuard.isCurrent(generation)) isListLoading.value = false
    }
  }

  const clearSelection = (): void => {
    selectGuard.cancel()
    selectedSlug.value = null
    preset.value = null
    previewSkinBytes.value = null
    isPresetLoading.value = false
    presetError.value = ''
    failedSlug.value = null
  }

  const selectPreset = async (slug: string): Promise<void> => {
    const generation = selectGuard.next()
    isPresetLoading.value = true
    presetError.value = ''
    failedSlug.value = slug
    try {
      const pkg = await source.fetch(slug)
      const parsed = await parsePresetProject(pkg.projectData, pkg.metaData)
      if (!selectGuard.isCurrent(generation)) return
      selectedSlug.value = slug
      preset.value = parsed
      previewSkinBytes.value = pkg.previewSkin
      failedSlug.value = null
    } catch (e: unknown) {
      if (!selectGuard.isCurrent(generation)) return
      reportError('Не удалось загрузить пресет', e)
      presetError.value = getErrorMessage(e)
    } finally {
      if (selectGuard.isCurrent(generation)) isPresetLoading.value = false
    }
  }

  const retryPreset = (): Promise<void> => {
    const slug = failedSlug.value
    if (slug === null) return Promise.resolve()
    return selectPreset(slug)
  }

  onScopeDispose(clearSelection)

  void loadCatalog()

  return {
    entries,
    isListLoading,
    listError,
    loadCatalog,
    selectedSlug,
    preset,
    previewSkinBytes,
    isPresetLoading,
    presetError,
    selectPreset,
    retryPreset,
    clearSelection,
  }
}
