import { ref, computed, watch, onMounted, onScopeDispose, nextTick } from 'vue'
import { getErrorMessage, reportError, useAsyncRaceGuard } from '@/06-shared'
import {
  getProfileSkin, readSkinFile, saveOfflineSkin, getOfflineSkin, getOfflineSkinModel, deleteOfflineSkin,
} from '@/06-shared/api'
import { useCoreStore, useNotificationStore, type UserContentItem, type SkinModelMode } from '@/05-entities'
import { useSkinUserContent } from '@/04-features/user-content/useUserContent'
import { useUserContentFile } from '@/04-features/user-content/useUserContentFile'

const SKIN_SIZE_UNIT = 64

function assertSkinSize(width: number, height: number): void {
  const isSupported = width > 0 && height > 0
    && width % SKIN_SIZE_UNIT === 0
    && (height === width || height * 2 === width)
  if (!isSupported) {
    throw new Error(`Неподдерживаемый размер скина ${width}x${height} — поддерживаются 64x32, 64x64 и кратные им форматы`)
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
  const isSkinLoading = ref<boolean>(false)
  const modelMode = ref<SkinModelMode>('classic')
  let restoringOfflineModel = false

  const hasSkin = computed((): boolean => skinUrl.value !== '')

  const activeSkin = computed((): UserContentItem | undefined => {
    const items = content.items.value
    if (items.length === 0) return undefined
    return items.find((item) => item.active === true) ?? items[0]
  })

  watch(activeSkin, (skin) => {
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

  let persistQueue: Promise<void> = Promise.resolve()

  const persistOfflineSkin = async (notify: boolean): Promise<void> => {
    if (!content.isOffline.value || skinFileBytes.value.length === 0) return
    const previous = persistQueue
    const run = async (): Promise<void> => {
      await previous
      try {
        await saveOfflineSkin(skinFileBytes.value, modelMode.value)
        if (notify) notification.show('Скин сохранён')
      } catch (e: unknown) {
        content.errorMessage.value = 'Не удалось сохранить скин на диск'
        reportError('Не удалось сохранить локальный скин', e)
      }
    }
    persistQueue = run()
    await persistQueue
  }

  watch(modelMode, () => {
    if (restoringOfflineModel) return
    void persistOfflineSkin(false)
  })

  const skinPreviewGuard = useAsyncRaceGuard()

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

  const loadOfflineSkin = async (): Promise<void> => {
    const generation = skinPreviewGuard.next()
    let dataUrl: string | null = null
    try {
      const bytes = await getOfflineSkin()
      if (!skinPreviewGuard.isCurrent(generation)) return
      if (bytes.length === 0) return
      dataUrl = await createPreviewUrl(bytes)
      if (!skinPreviewGuard.isCurrent(generation)) {
        discardPreviewUrl(dataUrl)
        return
      }
      skinFileBytes.value = bytes
      restoringOfflineModel = true
      const model = await getOfflineSkinModel()
      if (!skinPreviewGuard.isCurrent(generation)) {
        restoringOfflineModel = false
        discardPreviewUrl(dataUrl)
        return
      }
      if (model === 'slim' || model === 'classic') modelMode.value = model
      await nextTick()
      restoringOfflineModel = false
      adoptPreviewUrl(dataUrl)
    } catch (e: unknown) {
      restoringOfflineModel = false
      if (dataUrl !== null) discardPreviewUrl(dataUrl)
      content.errorMessage.value = getErrorMessage(e)
      reportError('Не удалось загрузить локальный скин', e)
    }
  }

  watch((): string => coreStore.currentProject, (): void => {
    skinPreviewGuard.cancel()
    resetSkinUrl()
    skinFileBytes.value = new Uint8Array()
    content.errorMessage.value = ''
    if (content.isOffline.value) {
      void loadOfflineSkin()
    }
  })

  const { isDragOver, openFileDialog: selectSkin } = useUserContentFile({
    accept: '.png,image/png',
    extensions: ['png'],
    maxBytes: 256 * 1024,
    readFile: readSkinFile,
    processFile: async (skinBytes: Uint8Array): Promise<void> => {
      const dataUrl = await createPreviewUrl(skinBytes)
      skinFileBytes.value = skinBytes
      adoptPreviewUrl(dataUrl)
      if (content.isOffline.value) {
        await persistOfflineSkin(true)
      }
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
    if (content.isOffline.value) {
      try {
        await deleteOfflineSkin()
      } catch (e: unknown) {
        reportError('Не удалось удалить локальный скин', e)
      }
    }
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

  onMounted(async (): Promise<void> => {
    isSkinLoading.value = true
    try {
      await content.loadItems()
      if (content.isOffline.value) {
        await loadOfflineSkin()
      } else {
        await loadCurrentSkin()
      }
    } finally {
      isSkinLoading.value = false
    }
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
    selectSkin,
    handleUpload,
    handleActivate,
    handleDelete,
    handleCopyUrl: content.handleCopyUrl,
    resetSkin,
  }
}
