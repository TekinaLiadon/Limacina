import { ref, computed, watch } from 'vue'
import { useCoreStore, useAccountsStore, useNotificationStore, type UserContentItem, type SkinModelMode } from '@/05-entities'
import { copyToClipboard, reportError, useAsyncRaceGuard } from '@/06-shared'
import {
  getErrorMessage,
  listSkins, uploadSkin, deleteSkin, setActiveSkin,
  listModels, uploadModel, deleteModel,
} from '@/06-shared/api'

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
  uploadErrorMessage: string
  deleteErrorMessage: string
  activateErrorMessage?: string
  listLoadErrorMessage: string
}

export function useUserContent<T>(api: UserContentApi<T>) {
  const coreStore = useCoreStore()
  const accountsStore = useAccountsStore()
  const notification = useNotificationStore()

  const items = ref<UserContentItem[]>([])
  const isUploading = ref<boolean>(false)
  const isMutating = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const isListLoading = ref<boolean>(false)
  const listError = ref<string>('')

  const isOffline = computed((): boolean => coreStore.isOfflineProject)

  const listGuard = useAsyncRaceGuard()
  const uploadGuard = useAsyncRaceGuard()
  const mutationGuard = useAsyncRaceGuard()

  const loadItems = async (): Promise<void> => {
    if (isOffline.value) return
    const uuid = accountsStore.session?.uuid
    if (!uuid) return

    const generation = listGuard.next()
    isListLoading.value = true
    listError.value = ''
    try {
      const loaded = await api.list(uuid)
      if (!listGuard.isCurrent(generation)) return
      items.value = loaded
    } catch (e: unknown) {
      if (!listGuard.isCurrent(generation)) return
      listError.value = `${api.listLoadErrorMessage}: ${getErrorMessage(e)}`
      reportError(api.listLoadErrorMessage, e)
    } finally {
      if (listGuard.isCurrent(generation)) isListLoading.value = false
    }
  }

  const handleUpload = async (payload: T): Promise<UserContentItem | null> => {
    if (isUploading.value) return null
    const generation = uploadGuard.next()
    isUploading.value = true
    errorMessage.value = ''

    try {
      const item = await api.upload(payload)
      if (!uploadGuard.isCurrent(generation)) return null
      notification.show(api.uploadSuccessMessage)
      await loadItems()
      return item
    } catch (e: unknown) {
      if (!uploadGuard.isCurrent(generation)) return null
      reportError(api.uploadErrorMessage, e)
      errorMessage.value = getErrorMessage(e)
      return null
    } finally {
      if (uploadGuard.isCurrent(generation)) isUploading.value = false
    }
  }

  const handleDelete = async (id: number): Promise<void> => {
    if (isMutating.value) return
    const generation = mutationGuard.next()
    isMutating.value = true
    errorMessage.value = ''
    try {
      await api.delete(id)
      if (!mutationGuard.isCurrent(generation)) return
      await loadItems()
    } catch (e: unknown) {
      if (!mutationGuard.isCurrent(generation)) return
      reportError(api.deleteErrorMessage, e)
      errorMessage.value = getErrorMessage(e)
    } finally {
      if (mutationGuard.isCurrent(generation)) isMutating.value = false
    }
  }

  const handleActivate = async (id: number): Promise<void> => {
    if (api.activate === undefined || isMutating.value) return
    const generation = mutationGuard.next()
    isMutating.value = true
    errorMessage.value = ''
    try {
      await api.activate(id)
      if (!mutationGuard.isCurrent(generation)) return
      await loadItems()
    } catch (e: unknown) {
      if (!mutationGuard.isCurrent(generation)) return
      reportError(api.activateErrorMessage ?? 'Не удалось установить скин', e)
      errorMessage.value = getErrorMessage(e)
    } finally {
      if (mutationGuard.isCurrent(generation)) isMutating.value = false
    }
  }

  const handleCopyUrl = async (url: string): Promise<void> => {
    try {
      await copyToClipboard(url)
      notification.show('Ссылка скопирована')
    } catch (e: unknown) {
      reportError('Не удалось скопировать ссылку', e)
      errorMessage.value = 'Не удалось скопировать'
    }
  }

  watch((): string => coreStore.currentProject, (): void => {
    listGuard.cancel()
    uploadGuard.cancel()
    mutationGuard.cancel()
    items.value = []
    isListLoading.value = false
    listError.value = ''
    errorMessage.value = ''
    isUploading.value = false
    isMutating.value = false
    void loadItems()
  })

  return {
    items,
    isUploading,
    isMutating,
    isListLoading,
    listError,
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
    uploadErrorMessage: 'Не удалось загрузить скин на сервер',
    deleteErrorMessage: 'Не удалось удалить скин',
    activateErrorMessage: 'Не удалось установить скин',
    listLoadErrorMessage: 'Не удалось загрузить список скинов',
  })
}

export function useModelUserContent() {
  return useUserContent({
    list: listModels,
    upload: uploadModel,
    delete: deleteModel,
    uploadSuccessMessage: 'Модель успешно загружена',
    uploadErrorMessage: 'Не удалось загрузить модель на сервер',
    deleteErrorMessage: 'Не удалось удалить модель',
    listLoadErrorMessage: 'Не удалось загрузить список моделей',
  })
}

export type ModelUserContent = ReturnType<typeof useModelUserContent>
