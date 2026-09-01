import { onMounted } from 'vue'
import { useCoreStore } from '@/05-entities'
import { loadSettingsProject } from '@/06-shared/api'

export function useProjectConfig() {
  const coreStore = useCoreStore()

  const fetchConfig = async (): Promise<void> => {
    if (!coreStore.currentProject) return
    if (coreStore.projectConfig?.projectName === coreStore.currentProject) return

    try {
      const config = await loadSettingsProject(coreStore.currentProject)
      coreStore.projectConfig = config
    } catch (e: unknown) {
      console.error('Не удалось загрузить конфиг проекта:', e)
    }
  }

  onMounted(() => {
    fetchConfig()
  })

  return { fetchConfig }
}
