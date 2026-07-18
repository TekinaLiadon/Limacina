import { ref, computed, onMounted } from 'vue'
import JSZip from 'jszip'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { selectFile, copyToClipboard } from '@/06-shared'
import { uploadModel, listModels, deleteModel } from '@/06-shared/api'
import type { CPMConfig, CPMChild, CPMData, UserContentItem } from '@/05-entities/core/types'

function isLayerEmpty(child: CPMChild): boolean {
  return child.size.x === 0 && child.size.y === 0 && child.size.z === 0
}

function collectLayers(children: CPMChild[] | undefined, result: CPMChild[], parentHidden: boolean): void {
  if (!children) return
  for (const child of children) {
    const isHidden = parentHidden || child.hidden === true || child.show === false
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
  const errorMessage = ref<string>('')
  const showEmptyLayers = ref<boolean>(false)
  const isUploading = ref<boolean>(false)
  const uploadedModels = ref<UserContentItem[]>([])
  const isLoadingModels = ref<boolean>(false)
  const txtFileData = ref<string>('')
  const txtFileName = ref<string>('')

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

  const activeLayerNames = computed((): string[] => {
    return allLayers.value.filter((child) => child._visible).map((child) => child.name)
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

          const skinBlob = await skinFile.async('blob')
          const textureUrl = URL.createObjectURL(skinBlob)

          cpmData.value = { config, textureUrl }
        } catch {
          errorMessage.value = 'Не удалось распаковать файл'
        }
      },
    })
  }

  function resetCpm(): void {
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)

    cpmData.value = null
    errorMessage.value = ''
  }

  const loadModels = async (): Promise<void> => {
    if (!coreStore.session?.uuid) return

    isLoadingModels.value = true
    try {
      uploadedModels.value = await listModels(coreStore.session.uuid)
    } catch (e: unknown) {
      console.error(e)
    } finally {
      isLoadingModels.value = false
    }
  }

  const selectTxtFile = (): void => {
    errorMessage.value = ''

    selectFile({
      accept: '.txt',
      maxBytes: 1 * 1024 * 1024,
      readAs: 'arrayBuffer',
      onError: (msg: string) => {
        errorMessage.value = msg
      },
      onLoad: async (file: File, result: string | ArrayBuffer) => {
        try {
          const text = new TextDecoder().decode(result as ArrayBuffer)
          txtFileData.value = text
          txtFileName.value = file.name
        } catch {
          errorMessage.value = 'Не удалось прочитать файл'
        }
      },
    })
  }

  const handleUploadModel = async (): Promise<void> => {
    if (!txtFileData.value) return

    isUploading.value = true
    errorMessage.value = ''

    try {
      await uploadModel(txtFileData.value)
      notification.show('Модель успешно загружена')
      txtFileData.value = ''
      txtFileName.value = ''
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
    activeLayerNames,
    isUploading,
    uploadedModels,
    isLoadingModels,
    txtFileData,
    txtFileName,
    selectCpmFile,
    resetCpm,
    selectTxtFile,
    handleUploadModel,
    handleDeleteModel,
    handleCopyUrl,
  }
}
