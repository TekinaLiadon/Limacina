import { useCoreStore, type ProjectConfig } from '@/05-entities'
import { useProjectSwitch } from '@/04-features/project-switch/useProjectSwitch'
import { finalizeSession } from '@/04-features/accounts/finalizeSession'

export async function applyCreatedProfile(config: ProjectConfig): Promise<void> {
  const coreStore = useCoreStore()
  if (!coreStore.projects.includes(config.projectName)) {
    coreStore.projects = [...coreStore.projects, config.projectName]
  }
  if (coreStore.launcherConfig) {
    coreStore.launcherConfig.projectNames = [...coreStore.projects]
    coreStore.launcherConfig.currentProject = config.projectName
  }
  coreStore.currentProject = config.projectName
  coreStore.projectConfig = config
  useProjectSwitch().resetAccountsState()

  await finalizeSession()
}
