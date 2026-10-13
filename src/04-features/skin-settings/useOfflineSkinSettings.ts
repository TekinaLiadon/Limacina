import { computed, nextTick, onMounted, watch } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { captureProjectScope, getErrorMessage, reportError } from '@/06-shared'
import {
  deleteOfflineSkin, getOfflineSkin, getOfflineSkinModel, saveOfflineSkin,
} from '@/06-shared/api'
import { useSkinSettings } from './useSkinSettings'

export function useOfflineSkinSettings(): ReturnType<typeof useSkinSettings> {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const settings = useSkinSettings()

  const isOffline = computed((): boolean => coreStore.isOfflineProject)

  let restoringOfflineModel = false
  let persistQueue: Promise<void> = Promise.resolve()

  const persistOfflineSkin = async (notify: boolean): Promise<void> => {
    if (!isOffline.value || settings.skinFileBytes.value.length === 0) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    const previous = persistQueue
    const run = async (): Promise<void> => {
      await previous
      if (!scope.isCurrent()) return
      try {
        await saveOfflineSkin(settings.skinFileBytes.value, settings.modelMode.value)
        if (notify && scope.isCurrent()) notification.show('Скин сохранён')
      } catch (e: unknown) {
        if (!scope.isCurrent()) return
        settings.errorMessage.value = 'Не удалось сохранить скин на диск'
        reportError('Не удалось сохранить локальный скин', e)
      }
    }
    persistQueue = run()
    await persistQueue
  }

  watch(settings.skinFileBytes, (): void => {
    if (restoringOfflineModel) return
    void persistOfflineSkin(true)
  })

  watch(settings.modelMode, (): void => {
    if (restoringOfflineModel) return
    void persistOfflineSkin(false)
  })

  const loadOfflineSkin = async (): Promise<void> => {
    const generation = settings.skinPreviewGuard.next()
    let dataUrl: string | null = null
    try {
      const bytes = await getOfflineSkin()
      if (!settings.skinPreviewGuard.isCurrent(generation)) return
      if (bytes.length === 0) return
      dataUrl = await settings.createPreviewUrl(bytes)
      if (!settings.skinPreviewGuard.isCurrent(generation)) {
        settings.discardPreviewUrl(dataUrl)
        return
      }
      settings.skinFileBytes.value = bytes
      restoringOfflineModel = true
      const model = await getOfflineSkinModel()
      if (!settings.skinPreviewGuard.isCurrent(generation)) {
        restoringOfflineModel = false
        settings.discardPreviewUrl(dataUrl)
        return
      }
      if (model === 'slim' || model === 'classic') settings.modelMode.value = model
      await nextTick()
      restoringOfflineModel = false
      settings.adoptPreviewUrl(dataUrl)
    } catch (e: unknown) {
      restoringOfflineModel = false
      if (dataUrl !== null) settings.discardPreviewUrl(dataUrl)
      settings.errorMessage.value = getErrorMessage(e)
      reportError('Не удалось загрузить локальный скин', e)
    }
  }

  watch((): string => coreStore.currentProject, (): void => {
    if (!isOffline.value) return
    void loadOfflineSkin()
  })

  const resetSkin = (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    return notification.runConfirmed('Сбросить текущий скин?', async (): Promise<void> => {
      await settings.resetSkinState()
      if (!isOffline.value || !scope.isCurrent()) return
      try {
        await deleteOfflineSkin()
      } catch (e: unknown) {
        if (!scope.isCurrent()) return
        reportError('Не удалось удалить локальный скин', e)
      }
    })
  }

  onMounted((): void => {
    if (!isOffline.value) return
    void settings.runSkinLoad(loadOfflineSkin)
  })

  return { ...settings, resetSkin }
}
