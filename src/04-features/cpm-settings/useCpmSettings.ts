import { ref, computed, onMounted } from 'vue'
import JSZip from 'jszip'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { selectFile, copyToClipboard, reportError } from '@/06-shared'
import { uploadModel, listModels, deleteModel } from '@/06-shared/api'
import { cpmProjectToBase64 } from '@/04-features'
import { parseCpmAnimations } from './cpmAnimationParser'
import type { CPMConfig, CPMChild, CPMData, UserContentItem } from '@/05-entities/core/types'

function isLayerEmpty(child: CPMChild): boolean {
  return child.size.x === 0 && child.size.y === 0 && child.size.z === 0
}

function collectLayers(children: CPMChild[] | undefined, result: CPMChild[], parentHidden: boolean): void {
  if (!children) return
  for (const child of children) {
    const isHidden = parentHidden || child.hidden === true
    child._hidden = isHidden
    child._visible = !isLayerEmpty(child) && !isHidden
    result.push(child)
    collectLayers(child.children, result, isHidden)
  }
}

export function useCpmSettings() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const cpmData = ref<CPMData | null>(null)
  const cpmFileBytes = ref<ArrayBuffer | null>(null)
  const errorMessage = ref<string>('')
  const showEmptyLayers = ref<boolean>(false)
  const isUploading = ref<boolean>(false)
  const uploadedModels = ref<UserContentItem[]>([])
  const isLoadingModels = ref<boolean>(false)

  const allLayers = computed((): CPMChild[] => {
    if (!cpmData.value) return []

    const layers: CPMChild[] = []
    cpmData.value.config.elements.forEach((element) => {
      collectLayers(element.children, layers, false)
    })
    return layers
  })

  const displayLayers = computed((): CPMChild[] => {
    if (showEmptyLayers.value) return allLayers.value
    return allLayers.value.filter((child) => !isLayerEmpty(child))
  })

  const activeLayerIds = computed((): number[] => {
    return allLayers.value
      .filter((child) => child._visible)
      .map((child) => child.storeID)
      .filter((storeID): storeID is number => storeID !== undefined)
  })

  function selectCpmFile(): void {
    errorMessage.value = ''

    selectFile({
      accept: '.cpmproject',
      maxBytes: 2 * 1024 * 1024,
      readAs: 'arrayBuffer',
      onError: (msg: string) => {
        errorMessage.value = msg
      },
      onLoad: async (_file: File, result: string | ArrayBuffer) => {
        try {
          const zip = await JSZip.loadAsync(result as ArrayBuffer)

          const configFile = zip.file('config.json')
          if (!configFile) {
            errorMessage.value = 'Файл не содержит config.json'
            return
          }

          const skinFile = zip.file('skin.png')
          if (!skinFile) {
            errorMessage.value = 'Файл не содержит skin.png'
            return
          }

          const configText = await configFile.async('string')
          const config: CPMConfig = JSON.parse(configText)
          const animations = await parseCpmAnimations(zip)

          const skinBlob = await skinFile.async('blob')
          const textureUrl = URL.createObjectURL(skinBlob)

          if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)
          cpmData.value = { config, textureUrl, animations }
          cpmFileBytes.value = result as ArrayBuffer
        } catch {
          errorMessage.value = 'Не удалось распаковать файл'
        }
      },
    })
  }

  function resetCpm(): void {
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)

    cpmData.value = null
    cpmFileBytes.value = null
    errorMessage.value = ''
  }

  const loadModels = async (): Promise<void> => {
    if (!coreStore.session?.uuid) return

    isLoadingModels.value = true
    try {
      uploadedModels.value = await listModels(coreStore.session.uuid)
    } catch (e: unknown) {
      reportError('Не удалось загрузить список моделей', e)
    } finally {
      isLoadingModels.value = false
    }
  }

  const handleUploadModel = async (): Promise<void> => {
    if (!cpmFileBytes.value) return

    isUploading.value = true
    errorMessage.value = ''

    try {
      const base64 = await cpmProjectToBase64(cpmFileBytes.value)
      await uploadModel(base64)
      notification.show('Модель успешно загружена')
      await loadModels()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    } finally {
      isUploading.value = false
    }
  }

  const handleDeleteModel = async (id: number): Promise<void> => {
    try {
      await deleteModel(id)
      await loadModels()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    }
  }

  const handleCopyUrl = async (url: string): Promise<void> => {
    try {
      await copyToClipboard(url)
      notification.show('Ссылка скопирована')
    } catch (e: unknown) {
      errorMessage.value = 'Не удалось скопировать'
    }
  }

  onMounted(loadModels)

  return {
    cpmData,
    errorMessage,
    showEmptyLayers,
    displayLayers,
    activeLayerIds,
    isUploading,
    uploadedModels,
    isLoadingModels,
    selectCpmFile,
    resetCpm,
    handleUploadModel,
    handleDeleteModel,
    handleCopyUrl,
  }
}
