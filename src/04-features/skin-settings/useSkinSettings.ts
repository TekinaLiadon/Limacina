import { ref, computed, watch, onMounted, onScopeDispose } from 'vue'
import { getErrorMessage, hasPngSignature, reportError, useAsyncRaceGuard } from '@/06-shared'
import { getProfileSkin, readSkinFile } from '@/06-shared/api'
import { useCoreStore, useNotificationStore, type UserContentItem, type SkinModelMode } from '@/05-entities'
import { useSkinUserContent } from '@/04-features/user-content/useUserContent'
import { useUserContentFile } from '@/04-features/user-content/useUserContentFile'

const SKIN_SIZE_UNIT = 64
const SKIN_TEXTURE_LOAD_ERROR = 'Не удалось загрузить текстуру скина'

function assertSkinSize(width: number, height: number): void {
  const isSupported = width > 0 && height > 0
    && width % SKIN_SIZE_UNIT === 0
    && (height === width || height * 2 === width)
  if (!isSupported) {
    throw new Error(`Неподдерживаемый размер скина ${width}x${height}, поддерживаются 64x32, 64x64 и кратные им форматы`)
  }
}

async function decodeSkinSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    throw new Error('Не удалось декодировать изображение')
  }
}

export function useSkinSettings() {
  const coreStore = useCoreStore()
  const content = useSkinUserContent()
  const notification = useNotificationStore()

  const skinUrl = ref<string>('')
  const skinFileBytes = ref<Uint8Array>(new Uint8Array())
  const skinLoadCount = ref<number>(0)
  const modelMode = ref<SkinModelMode>('classic')

  const isSkinLoading = computed<boolean>(() => skinLoadCount.value > 0)

  const hasSkin = computed((): boolean => skinUrl.value !== '')

  const setTextureError = (): void => {
    content.errorMessage.value = SKIN_TEXTURE_LOAD_ERROR
  }

  const activeSkin = computed((): UserContentItem | undefined => {
    const items = content.items.value
    if (items.length === 0) return undefined
    return items.find((item) => item.active === true) ?? items[0]
  })

  watch((): number | null | undefined => activeSkin.value?.id, () => {
    const skin = activeSkin.value
    if (skin?.model === 'slim') modelMode.value = 'slim'
    else if (skin?.model === 'classic') modelMode.value = 'classic'
  }, { immediate: true })

  const pendingPreviewUrls = new Set<string>()

  const createPreviewUrl = async (bytes: Uint8Array): Promise<string> => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    const size = await decodeSkinSize(blob)
    assertSkinSize(size.width, size.height)
    const url = URL.createObjectURL(blob)
    pendingPreviewUrls.add(url)
    return url
  }

  const adoptPreviewUrl = (url: string): void => {
    pendingPreviewUrls.delete(url)
    setSkinUrl(url)
  }

  const discardPreviewUrl = (url: string): void => {
    URL.revokeObjectURL(url)
    pendingPreviewUrls.delete(url)
  }

  const revokePendingPreviewUrls = (): void => {
    for (const url of pendingPreviewUrls) URL.revokeObjectURL(url)
    pendingPreviewUrls.clear()
  }

  const resetSkinUrl = (): void => {
    if (skinUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(skinUrl.value)
      pendingPreviewUrls.delete(skinUrl.value)
    }
    skinUrl.value = ''
  }

  const setSkinUrl = (url: string): void => {
    resetSkinUrl()
    skinUrl.value = url
  }

  const skinPreviewGuard = useAsyncRaceGuard()

  const runSkinLoad = async (load: () => Promise<void>): Promise<void> => {
    skinLoadCount.value += 1
    try {
      await load()
    } finally {
      skinLoadCount.value -= 1
    }
  }

  const fetchActiveSkinPreview = async (generation: number): Promise<void> => {
    const current = activeSkin.value
    if (!current) return
    try {
      const bytes = await getProfileSkin(current.url)
      if (!skinPreviewGuard.isCurrent(generation)) return
      const url = await createPreviewUrl(bytes)
      if (!skinPreviewGuard.isCurrent(generation)) {
        discardPreviewUrl(url)
        return
      }
      adoptPreviewUrl(url)
    } catch (e: unknown) {
      if (!skinPreviewGuard.isCurrent(generation)) return
      content.errorMessage.value = getErrorMessage(e)
      reportError('Не удалось загрузить текущий скин', e)
    }
  }

  const loadCurrentSkin = async (): Promise<void> => {
    if (!activeSkin.value || skinUrl.value !== '' || skinFileBytes.value.length > 0) return
    await fetchActiveSkinPreview(skinPreviewGuard.next())
  }

  watch((): string => coreStore.currentProject, (): void => {
    skinPreviewGuard.cancel()
    resetSkinUrl()
    skinFileBytes.value = new Uint8Array()
    content.errorMessage.value = ''
  })

  const { isDragOver, openFileDialog: selectSkin } = useUserContentFile({
    accept: '.png,image/png',
    extensions: ['png'],
    maxBytes: 256 * 1024,
    validateBytes: (skinBytes: Uint8Array): string | null =>
      hasPngSignature(skinBytes) ? null : 'Выбранный файл не является PNG-изображением',
    readFile: readSkinFile,
    processFile: async (skinBytes: Uint8Array): Promise<void> => {
      const dataUrl = await createPreviewUrl(skinBytes)
      skinFileBytes.value = skinBytes
      adoptPreviewUrl(dataUrl)
    },
    errorMessage: content.errorMessage,
  })

  const handleUpload = async (): Promise<void> => {
    if (skinFileBytes.value.length === 0) return
    await content.handleUpload({ fileData: skinFileBytes.value, model: modelMode.value })
  }

  const resetSkinState = async (): Promise<void> => {
    resetSkinUrl()
    skinFileBytes.value = new Uint8Array()
    content.errorMessage.value = ''
  }

  const resetSkin = (): Promise<void> =>
    notification.runConfirmed('Сбросить текущий скин?', async (): Promise<void> => {
      await resetSkinState()
    })

  const reloadSkinPreview = async (): Promise<void> => {
    const generation = skinPreviewGuard.next()
    await resetSkinState()
    await fetchActiveSkinPreview(generation)
  }

  const handleActivate = async (id: number): Promise<void> => {
    await content.handleActivate(id)
    await reloadSkinPreview()
  }

  const handleDelete = (id: number): Promise<void> =>
    notification.runConfirmed('Удалить скин из списка загруженных?', async (): Promise<void> => {
      await content.handleDelete(id)
      await reloadSkinPreview()
    })

  onMounted((): void => {
    void runSkinLoad(async (): Promise<void> => {
      await content.loadItems()
      await loadCurrentSkin()
    })
  })

  onScopeDispose((): void => {
    skinPreviewGuard.cancel()
    resetSkinUrl()
    revokePendingPreviewUrls()
  })

  return {
    hasSkin,
    skinUrl,
    errorMessage: content.errorMessage,
    setTextureError,
    isUploading: content.isUploading,
    isMutating: content.isMutating,
    isOffline: content.isOffline,
    uploadedSkins: content.items,
    isListLoading: content.isListLoading,
    listError: content.listError,
    loadList: content.loadItems,
    isSkinLoading,
    isDragOver,
    modelMode,
    skinFileBytes,
    selectSkin,
    handleUpload,
    handleActivate,
    handleDelete,
    handleCopyUrl: content.handleCopyUrl,
    resetSkin,
    resetSkinState,
    createPreviewUrl,
    adoptPreviewUrl,
    discardPreviewUrl,
    skinPreviewGuard,
    runSkinLoad,
  }
}
