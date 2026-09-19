import { onMounted } from 'vue'
import { useCoreStore } from '@/05-entities'
import { loadSettingsProject } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useProjectConfig() {
  const coreStore = useCoreStore()

  const fetchConfig = async (): Promise<void> => {
    const projectName = coreStore.currentProject
    if (!projectName) return
    if (coreStore.projectConfig?.projectName === projectName) return

    try {
      const config = await loadSettingsProject(projectName)
      if (coreStore.currentProject !== projectName) return
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
