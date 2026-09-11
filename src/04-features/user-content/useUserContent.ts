import { ref, onMounted } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { copyToClipboard, reportError } from '@/06-shared'
import {
  listSkins, uploadSkin, deleteSkin,
  listModels, uploadModel, deleteModel,
} from '@/06-shared/api'
import type { UserContentItem } from '@/05-entities/core/types'

interface UserContentApi<T> {
  list: (uuid: string) => Promise<UserContentItem[]>
  upload: (payload: T) => Promise<UserContentItem>
  delete: (id: number) => Promise<void>
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

  const loadItems = async (): Promise<void> => {
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
    loadItems,
    handleUpload,
    handleDelete,
    handleCopyUrl,
  }
}

export function useSkinUserContent() {
  return useUserContent({
    list: listSkins,
    upload: uploadSkin,
    delete: deleteSkin,
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
