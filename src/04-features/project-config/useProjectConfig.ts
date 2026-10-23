import { onMounted } from 'vue'
import { useCoreStore, type ProjectConfig } from '@/05-entities'
import { loadSettingsProject } from '@/06-shared/api'
import { captureProjectScope, runScopedAction } from '@/06-shared'

export function useProjectConfig() {
  const coreStore = useCoreStore()

  const fetchConfig = async (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    if (!scope.project) return
    if (coreStore.projectConfig?.projectName === scope.project) return

    await runScopedAction({
      scope,
      errorMessage: 'Не удалось загрузить конфиг проекта',
      run: (): Promise<ProjectConfig> => loadSettingsProject(scope.project),
      apply: (config: ProjectConfig): void => coreStore.setProjectConfig(config),
    })
  }

  onMounted((): void => {
    void fetchConfig()
  })

  return { fetchConfig }
}
