import { ref, computed, watch, onMounted, onScopeDispose } from 'vue'
import { selectFile, reportError } from '@/06-shared'
import {
  getProfileSkin, saveOfflineSkin, getOfflineSkin, getOfflineSkinModel, deleteOfflineSkin,
} from '@/06-shared/api'
import { useNotificationStore } from '@/05-entities'
import { useSkinUserContent } from '@/04-features/user-content/useUserContent'
import type { UserContentItem } from '@/05-entities/core/types'
import type { SkinModelMode } from '@/03-widgets/types'

async function loadBlobUrl(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
  try {
    const bitmap = await createImageBitmap(blob)
    bitmap.close()
  } catch {
    throw new Error('Не удалось декодировать изображение')
  }
  return URL.createObjectURL(blob)
}

export function useSkinSettings() {
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

  const resetSkinUrl = (): void => {
    if (skinUrl.value.startsWith('blob:')) URL.revokeObjectURL(skinUrl.value)
    skinUrl.value = ''
  }

  const setSkinUrl = (url: string): void => {
    resetSkinUrl()
    skinUrl.value = url
  }

  const persistOfflineSkin = async (notify: boolean): Promise<void> => {
    if (!content.isOffline.value || skinFileBytes.value.length === 0) return
    try {
      await saveOfflineSkin(skinFileBytes.value, modelMode.value)
      if (notify) notification.show('Скин сохранён')
    } catch (e: unknown) {
      content.errorMessage.value = 'Не удалось сохранить скин на диск'
      reportError('Не удалось сохранить локальный скин', e)
    }
  }

  watch(modelMode, () => {
    if (restoringOfflineModel) return
    void persistOfflineSkin(false)
  })

  const loadCurrentSkin = async (): Promise<void> => {
    const current = activeSkin.value
    if (!current || skinUrl.value !== '' || skinFileBytes.value.length > 0) return

    try {
      const bytes = await getProfileSkin(current.url)
      setSkinUrl(await loadBlobUrl(bytes))
    } catch (e: unknown) {
      reportError('Не удалось загрузить текущий скин', e)
    }
  }

  const loadOfflineSkin = async (): Promise<void> => {
    let dataUrl: string | null = null
    try {
      const bytes = await getOfflineSkin()
      if (bytes.length === 0) return
      dataUrl = await loadBlobUrl(bytes)
      skinFileBytes.value = bytes
      restoringOfflineModel = true
      const model = await getOfflineSkinModel()
      if (model === 'slim' || model === 'classic') modelMode.value = model
      restoringOfflineModel = false
      setSkinUrl(dataUrl)
      dataUrl = null
    } catch (e: unknown) {
      restoringOfflineModel = false
      if (dataUrl) URL.revokeObjectURL(dataUrl)
      reportError('Не удалось загрузить локальный скин', e)
    }
  }

  const selectSkin = (): void => {
    content.errorMessage.value = ''

    selectFile({
      accept: '.png,image/png',
      maxBytes: 256 * 1024,
      readAs: 'arrayBuffer',
      onError: (msg: string) => {
        content.errorMessage.value = msg
      },
      onLoad: async (_file: File, result: string | ArrayBuffer) => {
        try {
          const bytes = new Uint8Array(result as ArrayBuffer)
          const dataUrl = await loadBlobUrl(bytes)
          skinFileBytes.value = bytes
          setSkinUrl(dataUrl)
          if (content.isOffline.value) {
            await persistOfflineSkin(true)
          }
        } catch {
          content.errorMessage.value = 'Не удалось загрузить изображение'
        }
      },
    })
  }

  const handleUpload = async (): Promise<void> => {
    if (skinFileBytes.value.length === 0) return
    await content.handleUpload({ fileData: skinFileBytes.value, model: modelMode.value })
  }

  const resetSkin = async (): Promise<void> => {
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

  const reloadSkinPreview = async (): Promise<void> => {
    await resetSkin()
    await loadCurrentSkin()
  }

  const handleActivate = async (id: number): Promise<void> => {
    await content.handleActivate(id)
    await reloadSkinPreview()
  }

  const handleDelete = async (id: number): Promise<void> => {
    await content.handleDelete(id)
    await reloadSkinPreview()
  }

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
    resetSkinUrl()
  })

  return {
    hasSkin,
    skinUrl,
    errorMessage: content.errorMessage,
    isUploading: content.isUploading,
    isOffline: content.isOffline,
    uploadedSkins: content.items,
    isSkinLoading,
    modelMode,
    selectSkin,
    handleUpload,
    handleActivate,
    handleDelete,
    handleCopyUrl: content.handleCopyUrl,
    resetSkin,
  }
}
