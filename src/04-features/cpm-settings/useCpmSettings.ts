import { ref, computed, shallowRef, watch, onScopeDispose } from 'vue'
import { captureProjectScope, runScopedAction } from '@/06-shared'
import { useCoreStore, useNotificationStore, type CPMChild, type CPMData, type CPMElement, type CPMVec3, type UserContentItem } from '@/05-entities'
import { readCpmProjectFile, savePlayerModel } from '@/06-shared/api'
import { cpmProjectToLinkBase64 } from '@/04-features/cpm-convert/cpmProjectExporter'
import { useModelUserContent } from '@/04-features/user-content/useUserContent'
import { useUserContentFile } from '@/04-features/user-content/useUserContentFile'
import { parseCpmProjectFile, type CpmProject } from './cpmProjectParser'

export interface CpmLayer {
  storeId: number | null
  name: string
  visible: boolean
  empty: boolean
  group: string
}

export interface CpmLayerTabItem {
  id: string
  label: string
  disabled: boolean
}

export interface CpmLayerPanelData {
  tabs: string[]
  [tab: string]: unknown
}

const TEXTURE_LOAD_ERROR = 'Не удалось загрузить текстуру модели'

const LAYER_GROUP_LABELS: Record<string, string> = {
  head: 'Голова',
  body: 'Тело',
  left_arm: 'Левая рука',
  right_arm: 'Правая рука',
  left_leg: 'Левая нога',
  right_leg: 'Правая нога',
  custom_part: 'Дополнительно',
}

const layerGroupLabel = (element: CPMElement): string => {
  const name = typeof element.name === 'string' ? element.name.trim() : ''
  if (name !== '') return name
  if (element.customPart === true || element.dup === true) return 'Дополнительно'
  const id = typeof element.id === 'string' ? element.id : ''
  return LAYER_GROUP_LABELS[id.toLowerCase()] || id || 'Без группы'
}

const isZeroVec = (v: CPMVec3): boolean => v.x === 0 && v.y === 0 && v.z === 0

function collectLayers(children: CPMChild[] | undefined, group: string, result: CpmLayer[]): void {
  if (!children) return
  for (const child of children) {
    const empty = child.size !== undefined && isZeroVec(child.size)
    result.push({
      storeId: child.storeID ?? null,
      name: child.name,
      visible: !empty,
      empty,
      group,
    })
    collectLayers(child.children, group, result)
  }
}

export function useCpmSettings() {
  const coreStore = useCoreStore()
  const content = useModelUserContent()
  const notification = useNotificationStore()

  const cpmData = shallowRef<CPMData | null>(null)
  const cpmFileBytes = ref<Uint8Array | null>(null)
  const cpmFileName = ref<string>('')
  const isUploading = ref<boolean>(false)
  const showEmptyLayers = ref<boolean>(false)
  const hiddenLayerIds = ref<Set<number>>(new Set())

  const modelName = computed((): string => cpmFileName.value.trim() || 'Модель')

  const allLayers = computed((): CpmLayer[] => {
    if (!cpmData.value) return []

    const layers: CpmLayer[] = []
    cpmData.value.config.elements.forEach((element) => {
      collectLayers(element.children, layerGroupLabel(element), layers)
    })
    return layers.map((layer) => ({
      ...layer,
      visible: !layer.empty && !(layer.storeId !== null && hiddenLayerIds.value.has(layer.storeId)),
    }))
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

  const layerPanelData = computed((): CpmLayerPanelData => {
    const data: CpmLayerPanelData = { tabs: [] }
    for (const layer of displayLayers.value) {
      const tab = layer.group || 'Без группы'
      let items = data[tab] as CpmLayerTabItem[] | undefined
      if (!items) {
        items = []
        data[tab] = items
        data.tabs.push(tab)
      }
      const id = layer.storeId === null ? `${tab}:${items.length}` : String(layer.storeId)
      items.push({ id, label: layer.name, disabled: layer.storeId === null })
    }
    return data
  })

  const visibleLayerKeys = computed((): string[] =>
    activeLayerIds.value.map((storeId) => String(storeId)),
  )

  const toggleLayer = (storeId: number | null): void => {
    if (storeId === null) return
    const next = new Set(hiddenLayerIds.value)
    if (next.has(storeId)) {
      next.delete(storeId)
    } else {
      next.add(storeId)
    }
    hiddenLayerIds.value = next
  }

  const setVisibleLayerKeys = (next: string[]): void => {
    const nextSet = new Set(next)
    for (const layer of displayLayers.value) {
      if (layer.storeId === null) continue
      const visible = nextSet.has(String(layer.storeId))
      if (visible !== layer.visible) toggleLayer(layer.storeId)
    }
  }

  const setTextureError = (): void => {
    content.errorMessage.value = TEXTURE_LOAD_ERROR
  }

  watch(cpmData, (data): void => {
    if (!data) {
      hiddenLayerIds.value = new Set()
      return
    }
    const known = new Set<number>()
    allLayers.value.forEach((layer) => {
      if (layer.storeId !== null) known.add(layer.storeId)
    })
    hiddenLayerIds.value = new Set([...hiddenLayerIds.value].filter((id) => known.has(id)))
  })

  function applyCpmProject(project: CpmProject, bytes: Uint8Array, name: string): void {
    const textureUrl = URL.createObjectURL(project.textureBlob)
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)
    cpmData.value = {
      config: project.config,
      textureUrl,
      animations: project.animations,
      animEnc: project.animEnc,
    }
    cpmFileBytes.value = bytes
    cpmFileName.value = name
  }

  const { isDragOver, openFileDialog: selectCpmFile, loadFromPath } = useUserContentFile({
    accept: '.cpmproject',
    extensions: ['cpmproject'],
    maxBytes: 2 * 1024 * 1024,
    readFile: readCpmProjectFile,
    processFile: async (bytes: Uint8Array, name: string): Promise<void> => {
      const project = await parseCpmProjectFile(bytes)
      applyCpmProject(project, bytes, name.replace(/\.cpmproject$/i, ''))
    },
    errorMessage: content.errorMessage,
  })

  watch((): string | null => coreStore.pendingCpmProjectPath, (path: string | null): void => {
    if (!path) return
    coreStore.setPendingCpmProjectPath(null)
    void loadFromPath(path)
  }, { immediate: true })

  function resetCpmState(): void {
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)

    cpmData.value = null
    cpmFileBytes.value = null
    cpmFileName.value = ''
    hiddenLayerIds.value = new Set()
    isUploading.value = false
    content.errorMessage.value = ''
  }

  const resetCpm = (): Promise<void> =>
    notification.runConfirmed('Сбросить текущую модель?', (): void => {
      resetCpmState()
    })

  const handleDeleteModel = (id: number): Promise<void> =>
    notification.runConfirmed('Удалить модель из списка загруженных?', (): Promise<void> =>
      content.handleDelete(id))

  const rollbackUploadedModel = async (item: UserContentItem): Promise<void> => {
    if (item.id === null || item.id === undefined) return
    await content.handleDelete(item.id)
  }

  const handleUploadModel = async (): Promise<void> => {
    if (!cpmFileBytes.value || !cpmData.value) return
    if (isUploading.value) return

    const scope = captureProjectScope((): string => coreStore.currentProject)
    let uploaded: UserContentItem | null = null
    await runScopedAction({
      scope,
      busyFlag: isUploading,
      errorTarget: content.errorMessage,
      errorMessage: 'Не удалось сохранить модель',
      run: async (): Promise<boolean> => {
        try {
          const bytes = cpmFileBytes.value
          const data = cpmData.value
          if (!bytes || !data) return false
          const base64 = await cpmProjectToLinkBase64(bytes, data)
          uploaded = await content.handleUpload(base64)
          if (uploaded === null) return false

          await savePlayerModel(scope.project, {
            name: modelName.value,
            url: uploaded.url,
            modelId: uploaded.id ?? null,
            slim: data.config.skinType === 'slim',
            data: null,
          })
          return true
        } catch (e: unknown) {
          if (uploaded !== null) await rollbackUploadedModel(uploaded)
          throw e
        }
      },
      apply: (saved: boolean): void => {
        if (saved) notification.show('Модель добавлена в игру')
      },
    })
  }

  watch((): string => coreStore.currentProject, (): void => {
    resetCpmState()
  })

  void content.loadItems()

  onScopeDispose((): void => {
    resetCpmState()
  })

  return {
    cpmData,
    cpmFileBytes,
    modelName,
    errorMessage: content.errorMessage,
    showEmptyLayers,
    displayLayers,
    activeLayerIds,
    layerPanelData,
    visibleLayerKeys,
    setVisibleLayerKeys,
    toggleLayer,
    setTextureError,
    isUploading,
    isOffline: content.isOffline,
    uploadedModels: content.items,
    isListLoading: content.isListLoading,
    listError: content.listError,
    loadList: content.loadItems,
    isDragOver,
    selectCpmFile,
    resetCpm,
    loadFromPath,
    handleUploadModel,
    handleDeleteModel,
    handleCopyUrl: content.handleCopyUrl,
  }
}
