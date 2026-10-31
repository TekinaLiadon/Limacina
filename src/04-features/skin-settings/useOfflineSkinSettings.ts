import { computed, nextTick, onMounted, watch } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { captureProjectScope, reportError } from '@/06-shared'
import {
  deleteOfflineSkin, getOfflineSkin, getOfflineSkinModel, saveOfflineSkin,
} from '@/06-shared/api'
import { runPreviewLoad } from '@/04-features/user-content/previewUrls'
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
      try {
        await saveOfflineSkin(scope.project, settings.skinFileBytes.value, settings.modelMode.value)
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
    const project = coreStore.currentProject
    const generation = settings.skinPreviewGuard.next()
    await runPreviewLoad({
      generation,
      guard: settings.skinPreviewGuard,
      fetchBytes: async (): Promise<Uint8Array | null> => {
        const bytes = await getOfflineSkin(project)
        return bytes.length === 0 ? null : bytes
      },
      createUrl: settings.createPreviewUrl,
      adopt: settings.adoptPreviewUrl,
      discard: settings.discardPreviewUrl,
      errorTarget: settings.errorMessage,
      reportMessage: 'Не удалось загрузить локальный скин',
      beforeAdopt: async (bytes: Uint8Array): Promise<void> => {
        settings.skinFileBytes.value = bytes
        restoringOfflineModel = true
        try {
          const model = await getOfflineSkinModel(project)
          if (!settings.skinPreviewGuard.isCurrent(generation)) return
          if (model === 'slim' || model === 'classic') settings.modelMode.value = model
          await nextTick()
        } finally {
          restoringOfflineModel = false
        }
      },
    })
  }

  watch((): string => coreStore.currentProject, (): void => {
    if (!isOffline.value) return
    void loadOfflineSkin()
  })

  const resetSkin = (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    return notification.runConfirmed('Сбросить текущий скин?', async (): Promise<void> => {
      await settings.resetSkinState()
      if (!isOffline.value) return
      try {
        await deleteOfflineSkin(scope.project)
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
