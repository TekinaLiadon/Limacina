import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCoreStore } from '@/05-entities'
import { listenCpmProjectOpen, takeCpmProjectPath } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { setPendingCpmProjectPath } from './useCpmSettings'

export function useCpmProjectOpen(): void {
  const router = useRouter()
  const coreStore = useCoreStore()

  const openCpmProject = (path: string): void => {
    setPendingCpmProjectPath(path)
    if (!coreStore.launcherConfig) return
    void router.push({ name: 'SettingsModel' })
  }

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
