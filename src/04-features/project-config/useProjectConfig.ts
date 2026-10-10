import { onMounted } from 'vue'
import { useCoreStore } from '@/05-entities'
import { loadSettingsProject } from '@/06-shared/api'
import { captureProjectScope, reportError } from '@/06-shared'

export function useProjectConfig() {
  const coreStore = useCoreStore()

  const fetchConfig = async (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    if (!scope.project) return
    if (coreStore.projectConfig?.projectName === scope.project) return

    try {
      const config = await loadSettingsProject(scope.project)
      if (!scope.isCurrent()) return
      coreStore.projectConfig = config
    } catch (e: unknown) {
      reportError('Не удалось загрузить конфиг проекта', e)
    }
  }

  onMounted(() => {
    fetchConfig()
  })

  return { fetchConfig }
}
