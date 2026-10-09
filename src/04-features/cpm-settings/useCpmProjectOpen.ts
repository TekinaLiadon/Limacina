import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCoreStore } from '@/05-entities'
import { listenCpmProjectOpen, takeCpmProjectPath } from '@/06-shared/api'
import { createSingletonListeners, reportError } from '@/06-shared'

const cpmProjectOpenListeners = createSingletonListeners()

export function useCpmProjectOpen(): void {
  const router = useRouter()
  const coreStore = useCoreStore()

  if (cpmProjectOpenListeners.isStarted()) return

  const openCpmProject = (path: string): void => {
    coreStore.pendingCpmProjectPath = path
  }

  void cpmProjectOpenListeners.start(async (track): Promise<void> => {
    track(watch((): boolean => coreStore.pendingCpmProjectPath !== null && coreStore.launcherConfig !== null, (shouldOpen: boolean): void => {
      if (!shouldOpen) return
      void router.push({ name: 'SettingsModel' })
    }, { immediate: true }))
    try {
      const pending = await takeCpmProjectPath()
      if (pending) openCpmProject(pending)
    } catch (e: unknown) {
      reportError('Не удалось получить модель из аргументов запуска', e)
    }
    track(await listenCpmProjectOpen(openCpmProject))
  }).catch((e: unknown): void => {
    reportError('Не удалось подписаться на открытие файла модели', e)
  })
}
