import { ref, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { useNotificationStore, type CPMData } from '@/05-entities'
import { getErrorMessage, savePlayerModel } from '@/06-shared/api'
import { cpmProjectToBytes } from '@/04-features/cpm-convert/cpmProjectExporter'

export interface OfflineCpmModelSource {
  cpmFileBytes: Ref<Uint8Array | null>
  cpmData: ShallowRef<CPMData | null>
  modelName: ComputedRef<string>
  errorMessage: Ref<string>
}

export function useOfflineCpmModel(source: OfflineCpmModelSource): {
  isSaving: Ref<boolean>
  handleSaveModelOffline: () => Promise<void>
} {
  const notification = useNotificationStore()
  const isSaving = ref<boolean>(false)

  const handleSaveModelOffline = async (): Promise<void> => {
    if (!source.cpmFileBytes.value || !source.cpmData.value) return

    isSaving.value = true
    source.errorMessage.value = ''
    try {
      const bytes = await cpmProjectToBytes(source.cpmFileBytes.value)
      await savePlayerModel({
        name: source.modelName.value,
        url: null,
        modelId: null,
        slim: source.cpmData.value.config.skinType === 'slim',
        data: Array.from(bytes),
      })
      notification.show('Модель сохранена в игру')
    } catch (e: unknown) {
      source.errorMessage.value = getErrorMessage(e)
    } finally {
      isSaving.value = false
    }
  }

  return { isSaving, handleSaveModelOffline }
}
