import { computed } from 'vue'
import {
  useAccountsStore,
  useCoreStore,
  useLaunchStore,
  useNotificationStore,
  useProjectSettingsStore,
  useSettingsDirtyStore,
  projectSettingsFormFromConfig,
} from '@/05-entities'
import { authLogins, getErrorMessage, loadSettingsProject, saveCurrentProject } from '@/06-shared/api'
import { reportError, type DropdownOption } from '@/06-shared'
import { finalizeSession } from '@/04-features/accounts/finalizeSession'
import { useLaunchStepsStream } from '@/04-features/game-launch/useLaunchStepsStream'

export function useProjectSwitch() {
  const coreStore = useCoreStore()
  const accountsStore = useAccountsStore()
  const launchStore = useLaunchStore()
  const settingsDirtyStore = useSettingsDirtyStore()
  const projectSettingsStore = useProjectSettingsStore()
  const notification = useNotificationStore()
  const { resetLaunchSteps } = useLaunchStepsStream()

  const projectOptions = computed((): DropdownOption[] =>
    coreStore.projects.map((p) => ({ title: p, value: p }))
  )

  const canSwitch = computed((): boolean => coreStore.projects.length > 1)

  const resetAccountsState = (): void => {
    coreStore.clearSessionState()
    accountsStore.reset()
    launchStore.reset()
    resetLaunchSteps()
  }

  const isSwitching = computed((): boolean => accountsStore.isSwitching)

  const applyProjectSwitch = async (projectName: string): Promise<void> => {
    const projectConfig = await loadSettingsProject(projectName)
    const logins = await authLogins(projectName)
    await finalizeSession()

    coreStore.currentProject = projectName
    coreStore.projectConfig = projectConfig
    projectSettingsStore.adoptLoaded(projectName, projectSettingsFormFromConfig(projectConfig))
    resetAccountsState()
    accountsStore.logins = logins
  }

  const restoreSavedProject = async (projectName: string): Promise<boolean> => {
    if (!projectName) return true
    try {
      await saveCurrentProject(projectName)
      return true
    } catch (e: unknown) {
      reportError('Не удалось восстановить текущий проект', e)
      return false
    }
  }

  const selectProject = async (projectName: string): Promise<void> => {
    if (!projectName || projectName === coreStore.currentProject) return
    if (accountsStore.isSwitching) return
    if (coreStore.gameUsername) {
      notification.show('Нельзя переключить проект, пока запущена игра')
      return
    }
    if (launchStore.isLaunching) {
      notification.show('Дождитесь завершения запуска игры')
      return
    }
    if (accountsStore.authLoading || accountsStore.isLoading) {
      notification.show('Дождитесь завершения авторизации')
      return
    }
    if (projectSettingsStore.isDirty || settingsDirtyStore.hasDirtyTabs) {
      const confirmed = await notification.confirm(
        'В настройках есть несохранённые изменения. Переключить проект и потерять их?'
      )
      if (!confirmed) return
    }

    const previousProject = coreStore.currentProject
    accountsStore.isSwitching = true

    let backendOnNewProject = false

    try {
      await saveCurrentProject(projectName)
      backendOnNewProject = true
      await applyProjectSwitch(projectName)
    } catch (e: unknown) {
      let message = getErrorMessage(e)
      if (backendOnNewProject && coreStore.currentProject === previousProject) {
        const restored = await restoreSavedProject(previousProject)
        if (!restored) {
          message = `${message}. Не удалось вернуть предыдущий проект — после перезапуска откроется «${projectName}»`
        }
      }
      notification.show(message)
    } finally {
      accountsStore.isSwitching = false
    }
  }

  return {
    projectOptions,
    canSwitch,
    isSwitching,
    resetAccountsState,
    selectProject,
    applyProjectSwitch,
  }
}
