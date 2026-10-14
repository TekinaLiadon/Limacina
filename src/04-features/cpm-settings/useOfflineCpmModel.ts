import { ref, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { useCoreStore, useNotificationStore, type CPMData } from '@/05-entities'
import { captureProjectScope, reportError } from '@/06-shared'
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
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const isSaving = ref<boolean>(false)

  const handleSaveModelOffline = async (): Promise<void> => {
    if (!source.cpmFileBytes.value || !source.cpmData.value) return

    const scope = captureProjectScope((): string => coreStore.currentProject)
    isSaving.value = true
    source.errorMessage.value = ''
    try {
      const bytes = await cpmProjectToBytes(source.cpmFileBytes.value)
      await savePlayerModel(scope.project, {
        name: source.modelName.value,
        url: null,
        modelId: null,
        slim: source.cpmData.value.config.skinType === 'slim',
        data: Array.from(bytes),
      })
      if (!scope.isCurrent()) return
      notification.show('Модель сохранена в игру')
    } catch (e: unknown) {
      if (!scope.isCurrent()) return
      reportError('Не удалось сохранить модель в игру', e)
      source.errorMessage.value = getErrorMessage(e)
    } finally {
      isSaving.value = false
    }
  }

  return { isSaving, handleSaveModelOffline }
}
