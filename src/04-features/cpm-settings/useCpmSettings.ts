import { ref, computed, reactive } from 'vue'
import { selectFile } from '@/06-shared'
import { cpmProjectToBase64 } from '@/04-features'
import { useModelUserContent } from '@/04-features/user-content/useUserContent'
import { parseCpmProjectFile } from './cpmProjectParser'
import type { CPMChild, CPMData, CPMVec3 } from '@/05-entities/core/types'

export interface CpmLayer {
  storeId: number | null
  name: string
  visible: boolean
  empty: boolean
}

const isZeroVec = (v: CPMVec3): boolean => v.x === 0 && v.y === 0 && v.z === 0

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

  const cpmData = ref<CPMData | null>(null)
  const cpmFileBytes = ref<ArrayBuffer | null>(null)
  const showEmptyLayers = ref<boolean>(false)

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

  function selectCpmFile(): void {
    content.errorMessage.value = ''

    selectFile({
      accept: '.cpmproject',
      maxBytes: 2 * 1024 * 1024,
      readAs: 'arrayBuffer',
      onError: (msg: string) => {
        content.errorMessage.value = msg
      },
      onLoad: async (_file: File, result: string | ArrayBuffer) => {
        try {
          const project = await parseCpmProjectFile(result as ArrayBuffer)
          const textureUrl = URL.createObjectURL(project.textureBlob)

          if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)
          cpmData.value = {
            config: project.config,
            textureUrl,
            animations: project.animations,
          }
          cpmFileBytes.value = result as ArrayBuffer
        } catch (e) {
          content.errorMessage.value = e instanceof Error ? e.message : 'Не удалось распаковать файл'
        }
      },
    })
  }

  function resetCpm(): void {
    if (cpmData.value?.textureUrl) URL.revokeObjectURL(cpmData.value.textureUrl)

    cpmData.value = null
    cpmFileBytes.value = null
    content.errorMessage.value = ''
  }

  const handleUploadModel = async (): Promise<void> => {
    if (!cpmFileBytes.value) return

    const base64 = await cpmProjectToBase64(cpmFileBytes.value)
    await content.handleUpload(base64)
  }

  return {
    cpmData,
    errorMessage: content.errorMessage,
    showEmptyLayers,
    displayLayers,
    activeLayerIds,
    isUploading: content.isUploading,
    isOffline: content.isOffline,
    uploadedModels: content.items,
    selectCpmFile,
    resetCpm,
    handleUploadModel,
    handleDeleteModel: content.handleDelete,
    handleCopyUrl: content.handleCopyUrl,
  }
}
