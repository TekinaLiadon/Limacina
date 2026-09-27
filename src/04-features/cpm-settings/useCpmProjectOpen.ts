import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCoreStore } from '@/05-entities'
import { listenCpmProjectOpen, takeCpmProjectPath } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useCpmProjectOpen(): void {
  const router = useRouter()
  const coreStore = useCoreStore()

  const openCpmProject = (path: string): void => {
    coreStore.pendingCpmProjectPath = path
  }

  watch((): boolean => coreStore.pendingCpmProjectPath !== null && coreStore.launcherConfig !== null, (shouldOpen: boolean): void => {
    if (!shouldOpen) return
    void router.push({ name: 'SettingsModel' })
  }, { immediate: true })

  onMounted(async (): Promise<void> => {
    try {
      const pending = await takeCpmProjectPath()
      if (pending) openCpmProject(pending)
    } catch (e: unknown) {
      reportError('Не удалось получить модель из аргументов запуска', e)
    }
    try {
      await listenCpmProjectOpen(openCpmProject)
    } catch (e: unknown) {
      reportError('Не удалось подписаться на открытие файла модели', e)
    }
  })
}
