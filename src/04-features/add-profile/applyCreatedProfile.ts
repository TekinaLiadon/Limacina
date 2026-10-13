import { useCoreStore, type ProjectConfig } from '@/05-entities'
import { useProjectSwitch } from '@/04-features/project-switch/useProjectSwitch'
import { finalizeSession } from '@/04-features/accounts/finalizeSession'

export async function applyCreatedProfile(config: ProjectConfig): Promise<void> {
  const coreStore = useCoreStore()
  coreStore.addProject(config.projectName, config)
  useProjectSwitch().resetAccountsState()

  await finalizeSession()
}
