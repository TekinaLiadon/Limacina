import { useCoreStore, useProjectSettingsStore, projectSettingsFormFromConfig } from '@/05-entities'
import { getErrorMessage, loadSettingsProject } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export async function loadProjectConfig(project: string, force: boolean = false): Promise<boolean> {
  if (!project) return false
  const coreStore = useCoreStore()
  const store = useProjectSettingsStore()
  if (!force && (store.loadedProject === project || store.loadingProject === project)) {
    return store.isLoaded
  }

  store.startLoading(project)
  try {
    const loaded = await loadSettingsProject(project)
    store.applyLoaded(project, projectSettingsFormFromConfig(loaded))
    if (coreStore.currentProject === project) coreStore.projectConfig = loaded
    return true
  } catch (e: unknown) {
    reportError('Не удалось загрузить настройки проекта', e)
    store.applyError(project, getErrorMessage(e))
    return false
  } finally {
    store.finishLoading(project)
  }
}
