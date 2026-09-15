import { computed } from 'vue'
import { useAccountsStore, useCoreStore, useNotificationStore } from '@/05-entities'
import { authLogins, clearSession, getErrorMessage, loadSettingsProject, saveCurrentProject } from '@/06-shared/api'
import { useLaunchStepsStream } from '@/04-features'
import type { DropdownOption } from '@/06-shared/types'

export function useProjectSwitch() {
  const coreStore = useCoreStore()
  const accountsStore = useAccountsStore()
  const notification = useNotificationStore()
  const { resetLaunchSteps } = useLaunchStepsStream()

  const projectOptions = computed((): DropdownOption[] =>
    coreStore.projects.map((p) => ({ title: p, value: p }))
  )

  const canSwitch = computed((): boolean => coreStore.projects.length > 1)

  const resetAccountsState = (): void => {
    coreStore.isLoggedIn = false
    coreStore.session = null
    coreStore.loginError = ''
    accountsStore.logins = []
    accountsStore.selectedUsername = ''
    accountsStore.errorMessage = ''
    accountsStore.authError = ''
    accountsStore.loginFormData = { username: '', password: '', rememberMe: false }
    accountsStore.showAuthForm = false
    accountsStore.registerShowForm = false
    accountsStore.activeSubTab = 'login'
    accountsStore.isLaunching = false
    resetLaunchSteps()
  }

  const isSwitching = computed((): boolean => accountsStore.isSwitching)

  const selectProject = async (projectName: string): Promise<void> => {
    if (!projectName || projectName === coreStore.currentProject) return
    if (accountsStore.isSwitching) return
    if (coreStore.gameUsername) {
      notification.show('Нельзя переключить проект, пока запущена игра')
      return
    }
    if (accountsStore.isLaunching) {
      notification.show('Дождитесь завершения запуска игры')
      return
    }

    accountsStore.isSwitching = true
    const previousProject = coreStore.currentProject
    const previousConfig = coreStore.projectConfig

    coreStore.currentProject = projectName
    coreStore.projectConfig = null
    resetAccountsState()

    try {
      await clearSession()
      await saveCurrentProject(projectName)
      coreStore.projectConfig = await loadSettingsProject(projectName)
      accountsStore.logins = await authLogins(projectName)
    } catch (e: unknown) {
      coreStore.currentProject = previousProject
      coreStore.projectConfig = previousConfig
      notification.show(getErrorMessage(e))
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
  }
}
