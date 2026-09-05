import { ref, onMounted } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { selectFile, copyToClipboard, reportError } from '@/06-shared'
import { uploadSkin, listSkins, deleteSkin, getProfileSkin } from '@/06-shared/api'
import type { UserContentItem } from '@/05-entities/core/types'

export function useSkinSettings() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const skinUrl = ref<string>('')
  const skinFileBytes = ref<Uint8Array>(new Uint8Array())
  const errorMessage = ref<string>('')
  const isUploading = ref<boolean>(false)
  const uploadedSkins = ref<UserContentItem[]>([])
  const isLoadingSkins = ref<boolean>(false)
  const isSkinLoading = ref<boolean>(false)

  const loadSkins = async (): Promise<void> => {
    if (!coreStore.session?.uuid) return
    isLoadingSkins.value = true

    try {
      uploadedSkins.value = await listSkins(coreStore.session.uuid)
    } catch (e: unknown) {
      reportError('Не удалось загрузить список скинов', e)
    } finally {
      isLoadingSkins.value = false
    }
  }

  const resetSkinUrl = (): void => {
    if (skinUrl.value.startsWith('blob:')) URL.revokeObjectURL(skinUrl.value)
    skinUrl.value = ''
  }

  const loadCurrentSkin = async (): Promise<void> => {
    const current = uploadedSkins.value[0]
    if (!current || skinUrl.value !== '' || skinFileBytes.value.length > 0) return

    try {
      const bytes = await getProfileSkin(current.url)
      const blob = new Blob([bytes], { type: 'image/png' })
      const dataUrl = URL.createObjectURL(blob)
      await new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => {
          URL.revokeObjectURL(dataUrl)
          reject(new Error('Не удалось декодировать изображение'))
        }
        img.src = dataUrl
      })
      resetSkinUrl()
      skinUrl.value = dataUrl
    } catch (e: unknown) {
      reportError('Не удалось загрузить текущий скин', e)
    }
  }

  const selectSkin = (): void => {
    errorMessage.value = ''

    selectFile({
      accept: '.png,image/png',
      maxBytes: 256 * 1024,
      readAs: 'arrayBuffer',
      onError: (msg: string) => {
        errorMessage.value = msg
      },
      onLoad: (_file: File, result: string | ArrayBuffer) => {
        skinFileBytes.value = new Uint8Array(result as ArrayBuffer)

        const blob = new Blob([result as ArrayBuffer], { type: 'image/png' })
        const dataUrl = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          resetSkinUrl()
          skinUrl.value = dataUrl
        }
        img.onerror = () => {
          errorMessage.value = 'Не удалось загрузить изображение'
          URL.revokeObjectURL(dataUrl)
        }
        img.src = dataUrl
      },
    })
  }

  const handleUpload = async (): Promise<void> => {
    if (skinFileBytes.value.length === 0) return

    isUploading.value = true
    errorMessage.value = ''

    try {
      await uploadSkin(skinFileBytes.value)
      notification.show('Скин успешно загружен')
      await loadSkins()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    } finally {
      isUploading.value = false
    }
  }

  const handleDelete = async (id: number): Promise<void> => {
    try {
      await deleteSkin(id)
      await loadSkins()
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

  const resetSkin = (): void => {
    resetSkinUrl()
    skinFileBytes.value = new Uint8Array()
    errorMessage.value = ''
  }

  onMounted(async (): Promise<void> => {
    if (!coreStore.session?.uuid) return

    isSkinLoading.value = true
    try {
      await loadSkins()
      await loadCurrentSkin()
    } finally {
      isSkinLoading.value = false
    }
  })

  return {
    skinUrl,
    skinFileBytes,
    errorMessage,
    isUploading,
    uploadedSkins,
    isLoadingSkins,
    isSkinLoading,
    selectSkin,
    handleUpload,
    handleDelete,
    handleCopyUrl,
    resetSkin,
  }
}
