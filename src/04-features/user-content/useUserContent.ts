import { ref, computed, onMounted } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { copyToClipboard, reportError } from '@/06-shared'
import {
  listSkins, uploadSkin, deleteSkin, setActiveSkin,
  listModels, uploadModel, deleteModel,
} from '@/06-shared/api'
import type { UserContentItem } from '@/05-entities/core/types'
import type { SkinModelMode } from '@/03-widgets/types'

interface SkinUploadPayload {
  fileData: Uint8Array
  model: SkinModelMode
}

interface UserContentApi<T> {
  list: (uuid: string) => Promise<UserContentItem[]>
  upload: (payload: T) => Promise<UserContentItem>
  delete: (id: number) => Promise<void>
  activate?: (id: number) => Promise<void>
  uploadSuccessMessage: string
  listLoadErrorMessage: string
}

export function useUserContent<T>(api: UserContentApi<T>) {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const items = ref<UserContentItem[]>([])
  const isUploading = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const isListLoading = ref<boolean>(false)

  const isOffline = computed((): boolean => coreStore.projectConfig?.online === false)

  const loadItems = async (): Promise<void> => {
    if (isOffline.value) return
    const uuid = coreStore.session?.uuid
    if (!uuid) return

    isListLoading.value = true
    try {
      items.value = await api.list(uuid)
    } catch (e: unknown) {
      reportError(api.listLoadErrorMessage, e)
    } finally {
      isListLoading.value = false
    }
  }

  const handleUpload = async (payload: T): Promise<void> => {
    isUploading.value = true
    errorMessage.value = ''

    try {
      await api.upload(payload)
      notification.show(api.uploadSuccessMessage)
      await loadItems()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    } finally {
      isUploading.value = false
    }
  }

  const handleDelete = async (id: number): Promise<void> => {
    try {
      await api.delete(id)
      await loadItems()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    }
  }

  const handleActivate = async (id: number): Promise<void> => {
    if (api.activate === undefined) return
    try {
      await api.activate(id)
      await loadItems()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    }
  }

  const handleCopyUrl = async (url: string): Promise<void> => {
    try {
      await copyToClipboard(url)
      notification.show('Ссылка скопирована')
    } catch {
      errorMessage.value = 'Не удалось скопировать'
    }
  }

  onMounted(loadItems)

  return {
    items,
    isUploading,
    isListLoading,
    errorMessage,
    isOffline,
    loadItems,
    handleUpload,
    handleDelete,
    handleActivate,
    handleCopyUrl,
  }
}

export function useSkinUserContent() {
  return useUserContent<SkinUploadPayload>({
    list: listSkins,
    upload: ({ fileData, model }): Promise<UserContentItem> => uploadSkin(fileData, model),
    delete: deleteSkin,
    activate: setActiveSkin,
    uploadSuccessMessage: 'Скин успешно загружен',
    listLoadErrorMessage: 'Не удалось загрузить список скинов',
  })
}

export function useModelUserContent() {
  return useUserContent({
    list: listModels,
    upload: uploadModel,
    delete: deleteModel,
    uploadSuccessMessage: 'Модель успешно загружена',
    listLoadErrorMessage: 'Не удалось загрузить список моделей',
  })
}
