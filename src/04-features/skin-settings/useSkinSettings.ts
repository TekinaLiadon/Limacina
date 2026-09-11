import { ref, computed, watch, onMounted, onScopeDispose } from 'vue'
import { selectFile, reportError } from '@/06-shared'
import { getProfileSkin } from '@/06-shared/api'
import { useSkinUserContent } from '@/04-features/user-content/useUserContent'
import type { UserContentItem } from '@/05-entities/core/types'
import type { SkinModelMode } from '@/03-widgets/types'

function decodeImage(dataUrl: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Не удалось декодировать изображение'))
    img.src = dataUrl
  })
}

function loadBlobUrl(bytes: Uint8Array): Promise<string> {
  const dataUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
  return decodeImage(dataUrl).then(
    () => dataUrl,
    (e) => {
      URL.revokeObjectURL(dataUrl)
      throw e
    },
  )
}

export function useSkinSettings() {
  const content = useSkinUserContent()

  const skinUrl = ref<string>('')
  const skinFileBytes = ref<Uint8Array>(new Uint8Array())
  const isSkinLoading = ref<boolean>(false)
  const modelMode = ref<SkinModelMode>('classic')

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
        } catch {
          content.errorMessage.value = 'Не удалось загрузить изображение'
        }
      },
    })
  }

  const handleUpload = async (): Promise<void> => {
    if (skinFileBytes.value.length === 0) return
    await content.handleUpload(skinFileBytes.value)
  }

  const resetSkin = (): void => {
    resetSkinUrl()
    skinFileBytes.value = new Uint8Array()
    content.errorMessage.value = ''
  }

  const reloadSkinPreview = async (): Promise<void> => {
    resetSkin()
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
      await loadCurrentSkin()
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
