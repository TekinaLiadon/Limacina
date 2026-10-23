import { useCoreStore, useProjectSettingsStore, projectSettingsFormFromConfig, type ProjectConfig } from '@/05-entities'
import { getErrorMessage, loadSettingsProject } from '@/06-shared/api'
import { captureProjectScope, runScopedAction } from '@/06-shared'

export async function loadProjectConfig(project: string, force: boolean = false): Promise<boolean> {
  if (!project) return false
  const coreStore = useCoreStore()
  const store = useProjectSettingsStore()
  if (!force && (store.loadedProject === project || store.loadingProject === project)) {
    return store.isLoaded
  }

  const scope = captureProjectScope((): string => coreStore.currentProject)
  store.startLoading(project)
  const loaded = await runScopedAction({
    scope,
    errorMessage: 'Не удалось загрузить настройки проекта',
    onError: (e: unknown): void => store.applyError(project, getErrorMessage(e)),
    run: (): Promise<ProjectConfig> => loadSettingsProject(project),
    apply: (config: ProjectConfig): boolean => {
      store.applyLoaded(project, projectSettingsFormFromConfig(config))
      if (scope.project === project) coreStore.setProjectConfig(config)
      return true
    },
  })
  store.finishLoading(project)
  return loaded ?? false
}
