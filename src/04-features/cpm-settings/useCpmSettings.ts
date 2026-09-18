import { ref, computed, reactive, watch, onScopeDispose } from 'vue'
import { reportError } from '@/06-shared'
import { useNotificationStore, type CPMChild, type CPMData, type CPMVec3 } from '@/05-entities'
import {
  getErrorMessage,
  getPlayerModelsLimit,
  readCpmProjectFile,
  savePlayerModel,
  setPlayerModelsLimit,
} from '@/06-shared/api'
import { cpmProjectToLinkBase64, cpmProjectToBytes } from '@/04-features'
import { useModelUserContent } from '@/04-features/user-content/useUserContent'
import { useUserContentFile } from '@/04-features/user-content/useUserContentFile'
import { parseCpmProjectFile, type CpmProject } from './cpmProjectParser'

export interface CpmLayer {
  storeId: number | null
  name: string
  visible: boolean
  empty: boolean
}

const isZeroVec = (v: CPMVec3): boolean => v.x === 0 && v.y === 0 && v.z === 0

const pendingOpenPath = ref<string | null>(null)

export function setPendingCpmProjectPath(path: string): void {
  pendingOpenPath.value = path
}

function collectLayers(children: CPMChild[] | undefined, inheritedHidden: boolean, result: CpmLayer[]): void {
  if (!children) return
  for (const child of children) {
    const isHidden = inheritedHidden || child.hidden === true
    const empty = child.size !== undefined && isZeroVec(child.size)
    result.push(reactive({
      storeId: child.storeID ?? null,
      name: child.name,
      visible: !empty && !isHidden,
      empty,
    }))
    collectLayers(child.children, isHidden, result)
  }
}

export function useCpmSettings() {
  const content = useModelUserContent()
  const notification = useNotificationStore()

  const cpmData = ref<CPMData | null>(null)
  const cpmFileBytes = ref<ArrayBuffer | null>(null)
  const cpmFileName = ref<string>('')
  const isSaving = ref<boolean>(false)
  const isUploading = ref<boolean>(false)
  const showEmptyLayers = ref<boolean>(false)
  const modelsLimit = ref<number | null>(null)
  const isLimitLoading = ref<boolean>(false)
  const limitLoadError = ref<string>('')

  const modelName = computed((): string => cpmFileName.value.trim() || 'Модель')

  const allLayers = computed((): CpmLayer[] => {
    if (!cpmData.value) return []

    const layers: CpmLayer[] = []
    cpmData.value.config.elements.forEach((element) => {
      collectLayers(element.children, false, layers)
    })
    return layers
  })

  const displayLayers = computed((): CpmLayer[] =>
    showEmptyLayers.value ? allLayers.value : allLayers.value.filter((layer) => !layer.empty),
  )

  const activeLayerIds = computed((): number[] =>
    allLayers.value
      .filter((layer) => layer.visible)
      .map((layer) => layer.storeId)
      .filter((storeId): storeId is number => storeId !== null),
  )

  function applyCpmProject(project: CpmProject, bytes: ArrayBuffer, name: string): void {
    const textureUrl = URL.createObjectURL(project.textureBlob)
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)
    cpmData.value = {
      config: project.config,
      textureUrl,
      animations: project.animations,
    }
    cpmFileBytes.value = bytes
    cpmFileName.value = name
  }

  const { isDragOver, openFileDialog: selectCpmFile, loadFromPath } = useUserContentFile({
    accept: '.cpmproject',
    extensions: ['cpmproject'],
    maxBytes: 2 * 1024 * 1024,
    readFile: readCpmProjectFile,
    processFile: async (bytes: ArrayBuffer, name: string): Promise<void> => {
      const project = await parseCpmProjectFile(bytes)
      applyCpmProject(project, bytes, name.replace(/\.cpmproject$/i, ''))
    },
    errorMessage: content.errorMessage,
  })

  watch(pendingOpenPath, (path: string | null): void => {
    if (!path) return
    pendingOpenPath.value = null
    void loadFromPath(path)
  }, { immediate: true })

  function resetCpmState(): void {
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)

    cpmData.value = null
    cpmFileBytes.value = null
    cpmFileName.value = ''
    content.errorMessage.value = ''
  }

  const resetCpm = async (): Promise<void> => {
    const confirmed = await notification.confirm('Сбросить текущую модель?')
    if (!confirmed) return
    resetCpmState()
  }

  const handleDeleteModel = async (id: number): Promise<void> => {
    const confirmed = await notification.confirm('Удалить модель из списка загруженных?')
    if (!confirmed) return
    await content.handleDelete(id)
  }

  const handleUploadModel = async (): Promise<void> => {
    if (!cpmFileBytes.value || !cpmData.value) return
    if (isUploading.value) return

    isUploading.value = true
    content.errorMessage.value = ''
    try {
      const base64 = await cpmProjectToLinkBase64(cpmFileBytes.value)
      const item = await content.handleUpload(base64)
      if (!item) return

      await savePlayerModel({
        name: modelName.value,
        url: item.url,
        modelId: item.id ?? null,
        slim: cpmData.value.config.skinType === 'slim',
        data: null,
      })
      notification.show('Модель добавлена в игру')
    } catch (e: unknown) {
      content.errorMessage.value = getErrorMessage(e)
    } finally {
      isUploading.value = false
    }
  }

  const handleSaveModelOffline = async (): Promise<void> => {
    if (!cpmFileBytes.value || !cpmData.value) return

    isSaving.value = true
    content.errorMessage.value = ''
    try {
      const bytes = await cpmProjectToBytes(cpmFileBytes.value)
      await savePlayerModel({
        name: modelName.value,
        url: null,
        modelId: null,
        slim: cpmData.value.config.skinType === 'slim',
        data: Array.from(bytes),
      })
      notification.show('Модель сохранена в игру')
    } catch (e: unknown) {
      content.errorMessage.value = getErrorMessage(e)
    } finally {
      isSaving.value = false
    }
  }

  const loadModelsLimit = async (): Promise<void> => {
    isLimitLoading.value = true
    limitLoadError.value = ''
    try {
      modelsLimit.value = await getPlayerModelsLimit()
    } catch (e: unknown) {
      reportError('Не удалось загрузить лимит моделей', e)
      limitLoadError.value = getErrorMessage(e)
    } finally {
      isLimitLoading.value = false
    }
  }

  const handleSaveModelsLimit = async (limit: number | null): Promise<void> => {
    if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
      content.errorMessage.value = 'Лимит моделей — положительное число или пустое значение'
      return
    }
    try {
      await setPlayerModelsLimit(limit)
      modelsLimit.value = limit
      limitLoadError.value = ''
    } catch (e: unknown) {
      content.errorMessage.value = getErrorMessage(e)
    }
  }

  void loadModelsLimit()

  onScopeDispose((): void => {
    resetCpmState()
  })

  return {
    cpmData,
    errorMessage: content.errorMessage,
    showEmptyLayers,
    displayLayers,
    activeLayerIds,
    isUploading,
    isSaving,
    isOffline: content.isOffline,
    uploadedModels: content.items,
    isListLoading: content.isListLoading,
    modelsLimit,
    isLimitLoading,
    limitLoadError,
    isDragOver,
    selectCpmFile,
    resetCpm,
    loadFromPath,
    handleUploadModel,
    handleSaveModelOffline,
    handleDeleteModel,
    handleCopyUrl: content.handleCopyUrl,
    handleSaveModelsLimit,
  }
}
