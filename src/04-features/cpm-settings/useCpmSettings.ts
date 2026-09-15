import { ref, computed, reactive, watch, onScopeDispose } from 'vue'
import { selectFile } from '@/06-shared'
import { useNotificationStore } from '@/05-entities'
import { getErrorMessage, readCpmProjectFile, savePlayerModel } from '@/06-shared/api'
import { cpmProjectToLinkBase64, cpmProjectToBytes } from '@/04-features'
import { useModelUserContent } from '@/04-features/user-content/useUserContent'
import { parseCpmProjectFile, type CpmProject } from './cpmProjectParser'
import type { CPMChild, CPMData, CPMVec3 } from '@/05-entities/core/types'

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
  const showEmptyLayers = ref<boolean>(false)

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

  function selectCpmFile(): void {
    content.errorMessage.value = ''

    selectFile({
      accept: '.cpmproject',
      maxBytes: 2 * 1024 * 1024,
      readAs: 'arrayBuffer',
      onError: (msg: string) => {
        content.errorMessage.value = msg
      },
      onLoad: async (file: File, result: string | ArrayBuffer) => {
        try {
          const project = await parseCpmProjectFile(result as ArrayBuffer)
          applyCpmProject(project, result as ArrayBuffer, file.name.replace(/\.cpmproject$/i, ''))
        } catch (e) {
          content.errorMessage.value = getErrorMessage(e)
        }
      },
    })
  }

  const loadFromPath = async (path: string): Promise<void> => {
    content.errorMessage.value = ''
    try {
      const bytes = await readCpmProjectFile(path)
      const project = await parseCpmProjectFile(bytes)
      const fileName = path.split(/[\\/]/).pop() ?? path
      applyCpmProject(project, bytes, fileName.replace(/\.cpmproject$/i, ''))
    } catch (e: unknown) {
      content.errorMessage.value = getErrorMessage(e)
    }
  }

  watch(pendingOpenPath, (path: string | null): void => {
    if (!path) return
    pendingOpenPath.value = null
    void loadFromPath(path)
  }, { immediate: true })

  function resetCpm(): void {
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)

    cpmData.value = null
    cpmFileBytes.value = null
    cpmFileName.value = ''
    content.errorMessage.value = ''
  }

  const handleUploadModel = async (): Promise<void> => {
    if (!cpmFileBytes.value || !cpmData.value) return

    const base64 = await cpmProjectToLinkBase64(cpmFileBytes.value)
    const item = await content.handleUpload(base64)
    if (!item) return

    try {
      await savePlayerModel({
        name: modelName.value,
        url: item.url,
        modelId: item.id ?? null,
        slim: cpmData.value.config.skinType === 'slim',
        data: null,
      })
      notification.show('Модель добавлена в игру')
    } catch (e: unknown) {
      content.errorMessage.value = String(e)
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
      content.errorMessage.value = String(e)
    } finally {
      isSaving.value = false
    }
  }

  onScopeDispose((): void => {
    resetCpm()
  })

  return {
    cpmData,
    errorMessage: content.errorMessage,
    showEmptyLayers,
    displayLayers,
    activeLayerIds,
    isUploading: content.isUploading,
    isSaving,
    isOffline: content.isOffline,
    uploadedModels: content.items,
    selectCpmFile,
    resetCpm,
    loadFromPath,
    handleUploadModel,
    handleSaveModelOffline,
    handleDeleteModel: content.handleDelete,
    handleCopyUrl: content.handleCopyUrl,
  }
}
