import { ref, computed, watch, onMounted, onScopeDispose } from 'vue'
import { hasPngSignature, useAsyncRaceGuard } from '@/06-shared'
import { getProfileSkin, readSkinFile } from '@/06-shared/api'
import { useCoreStore, useNotificationStore, type UserContentItem, type SkinModelMode } from '@/05-entities'
import { useSkinUserContent } from '@/04-features/user-content/useUserContent'
import { useUserContentFile } from '@/04-features/user-content/useUserContentFile'
import { createPreviewBlobHolder, runPreviewLoad } from '@/04-features/user-content/previewUrls'
import {
  createConfirmedContentActions,
  createTextureErrorSetter,
} from '@/04-features/user-content/contentSettingsActions'

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

  const setTextureError = createTextureErrorSetter(content.errorMessage, SKIN_TEXTURE_LOAD_ERROR)

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

  const previews = createPreviewBlobHolder({
    getCurrentUrl: (): string => skinUrl.value,
    applyCurrentUrl: (url: string): void => {
      skinUrl.value = url
    },
    clearCurrentUrl: (): void => {
      skinUrl.value = ''
    },
  })

  const createPreviewUrl = async (bytes: Uint8Array): Promise<string> => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    const size = await decodeSkinSize(blob)
    assertSkinSize(size.width, size.height)
    const url = URL.createObjectURL(blob)
    previews.track(url)
    return url
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

  const loadActiveSkinPreview = async (generation: number): Promise<void> => {
    const current = activeSkin.value
    if (!current) return
    await runPreviewLoad({
      generation,
      guard: skinPreviewGuard,
      fetchBytes: (): Promise<Uint8Array> => getProfileSkin(current.url),
      createUrl: createPreviewUrl,
      adopt: previews.adopt,
      discard: previews.discard,
      errorTarget: content.errorMessage,
      reportMessage: 'Не удалось загрузить текущий скин',
    })
  }

  const loadCurrentSkin = async (): Promise<void> => {
    if (!activeSkin.value || skinUrl.value !== '' || skinFileBytes.value.length > 0) return
    await loadActiveSkinPreview(skinPreviewGuard.next())
  }

  watch((): string => coreStore.currentProject, (): void => {
    skinPreviewGuard.cancel()
    previews.releaseCurrent()
    skinFileBytes.value = new Uint8Array()
    content.errorMessage.value = ''
  })

  const { isDragOver, openFileDialog: selectSkin } = useUserContentFile({
    accept: '.png,image/png',
    extensions: ['png'],
    maxBytes: 512 * 1024,
    validateBytes: (skinBytes: Uint8Array): string | null =>
      hasPngSignature(skinBytes) ? null : 'Выбранный файл не является PNG-изображением',
    readFile: readSkinFile,
    processFile: async (skinBytes: Uint8Array): Promise<void> => {
      const dataUrl = await createPreviewUrl(skinBytes)
      skinFileBytes.value = skinBytes
      previews.adopt(dataUrl)
    },
    errorMessage: content.errorMessage,
  })

  const handleUpload = async (): Promise<void> => {
    if (skinFileBytes.value.length === 0) return
    await content.handleUpload({ fileData: skinFileBytes.value, model: modelMode.value })
  }

  const resetSkinState = async (): Promise<void> => {
    previews.releaseCurrent()
    skinFileBytes.value = new Uint8Array()
    content.errorMessage.value = ''
  }

  const confirmedActions = createConfirmedContentActions(notification, content, {
    reset: 'Сбросить текущий скин?',
    delete: 'Удалить скин из списка загруженных?',
  })

  const resetSkin = (): Promise<void> => confirmedActions.runReset(resetSkinState)

  const reloadSkinPreview = async (): Promise<void> => {
    const generation = skinPreviewGuard.next()
    await resetSkinState()
    await loadActiveSkinPreview(generation)
  }

  const handleActivate = async (id: number): Promise<void> => {
    await content.handleActivate(id)
    await reloadSkinPreview()
  }

  const handleDelete = (id: number): Promise<void> => confirmedActions.runDelete(id, reloadSkinPreview)

  onMounted((): void => {
    void runSkinLoad(async (): Promise<void> => {
      await content.loadItems()
      await loadCurrentSkin()
    })
  })

  onScopeDispose((): void => {
    skinPreviewGuard.cancel()
    previews.releaseCurrent()
    previews.revokePending()
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
    adoptPreviewUrl: previews.adopt,
    discardPreviewUrl: previews.discard,
    skinPreviewGuard,
    runSkinLoad,
  }
}
