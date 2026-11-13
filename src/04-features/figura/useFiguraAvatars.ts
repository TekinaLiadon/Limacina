import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useFiguraStore, type FiguraAvatarData, type FiguraAvatarEntry } from '@/05-entities'
import { reportError, storeBinding, useAsyncRaceGuard } from '@/06-shared'
import { getErrorMessage, listFiguraAvatars, readFiguraAvatar } from '@/06-shared/api'
import { parseFiguraModel } from './figuraParser'
import type { FiguraViewerSource } from './useFiguraViewer'

const LIST_LOAD_ERROR = 'Не удалось загрузить список аватаров Figura'
const MODEL_LOAD_ERROR = 'Не удалось прочитать model.bbmodel аватара'
const MODEL_PARSE_ERROR = 'Не удалось разобрать модель аватара Figura'
const TEXTURE_LOAD_ERROR = 'Не удалось прочитать текстуру аватара'

export interface FiguraAvatarsApi {
  avatars: ComputedRef<FiguraAvatarEntry[] | null>
  selectedName: ComputedRef<string | null>
  selected: ComputedRef<FiguraAvatarEntry | null>
  isListLoading: Ref<boolean>
  listError: Ref<string>
  isModelLoading: Ref<boolean>
  modelError: Ref<string>
  textureError: Ref<string>
  viewerSource: Ref<FiguraViewerSource | null>
  loadList: () => Promise<void>
  selectAvatar: (name: string | null) => Promise<void>
  loadModel: () => Promise<void>
  reset: () => void
}

export function useFiguraAvatars(): FiguraAvatarsApi {
  const coreStore = useCoreStore()
  const store = useFiguraStore()

  const avatars = computed((): FiguraAvatarEntry[] | null => store.list)
  const selectedName = computed((): string | null => store.selectedName)
  const selected = computed((): FiguraAvatarEntry | null => {
    const entries = store.list
    const name = store.selectedName
    if (entries === null || name === null) return null
    return entries.find((entry) => entry.name === name) ?? null
  })

  const isListLoading = storeBinding(store, 'isListLoading')
  const listError = storeBinding(store, 'listError')
  const isModelLoading = ref<boolean>(false)
  const modelError = ref<string>('')
  const textureError = ref<string>('')
  const viewerSource = ref<FiguraViewerSource | null>(null)

  const listGuard = useAsyncRaceGuard()
  const modelGuard = useAsyncRaceGuard()

  const clearModelState = (): void => {
    modelGuard.cancel()
    isModelLoading.value = false
    modelError.value = ''
    textureError.value = ''
    viewerSource.value = null
  }

  const applyAvatarData = (data: FiguraAvatarData): void => {
    try {
      const parsed = parseFiguraModel(data.model)
      viewerSource.value = { model: parsed.model, texturePng: parsed.texturePng }
      if (parsed.texturePng === null) textureError.value = TEXTURE_LOAD_ERROR
    } catch (e: unknown) {
      modelError.value = `${MODEL_LOAD_ERROR}: ${getErrorMessage(e)}`
      reportError(MODEL_PARSE_ERROR, e)
    }
  }

  const loadModel = async (): Promise<void> => {
    const project = coreStore.currentProject
    const name = selectedName.value
    if (!project || name === null) {
      clearModelState()
      return
    }

    const entry = store.list?.find((item) => item.name === name)
    const generation = modelGuard.next()
    modelError.value = ''
    textureError.value = ''
    viewerSource.value = null
    if (entry !== undefined && !entry.hasModel) {
      isModelLoading.value = false
      modelError.value = MODEL_LOAD_ERROR
      return
    }

    isModelLoading.value = true
    try {
      const data = await readFiguraAvatar(project, name)
      if (!modelGuard.isCurrent(generation)) return
      applyAvatarData(data)
    } catch (e: unknown) {
      if (!modelGuard.isCurrent(generation)) return
      modelError.value = getErrorMessage(e)
      reportError(MODEL_LOAD_ERROR, e)
    } finally {
      if (modelGuard.isCurrent(generation)) isModelLoading.value = false
    }
  }

  const selectAvatar = async (name: string | null): Promise<void> => {
    store.select(name)
    clearModelState()
    await loadModel()
  }

  const loadList = async (): Promise<void> => {
    const project = coreStore.currentProject
    if (!project) {
      reset()
      return
    }

    const generation = listGuard.next()
    isListLoading.value = true
    listError.value = ''
    try {
      const entries = await listFiguraAvatars(project)
      if (!listGuard.isCurrent(generation)) return
      store.setList(entries)
      const selectedValue = selectedName.value
      if (selectedValue !== null && !entries.some((entry) => entry.name === selectedValue)) {
        store.select(null)
        clearModelState()
      }
    } catch (e: unknown) {
      if (!listGuard.isCurrent(generation)) return
      listError.value = getErrorMessage(e)
      reportError(LIST_LOAD_ERROR, e)
    } finally {
      if (listGuard.isCurrent(generation)) isListLoading.value = false
    }
  }

  const reset = (): void => {
    listGuard.cancel()
    store.reset()
    clearModelState()
  }

  watch((): string => coreStore.currentProject, (): void => {
    reset()
  })

  return {
    avatars,
    selectedName,
    selected,
    isListLoading,
    listError,
    isModelLoading,
    modelError,
    textureError,
    viewerSource,
    loadList,
    selectAvatar,
    loadModel,
    reset,
  }
}
