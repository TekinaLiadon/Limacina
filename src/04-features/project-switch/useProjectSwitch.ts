import { computed } from 'vue'
import { useAccountsStore, useCoreStore, useNotificationStore } from '@/05-entities'
import { authLogins, clearSession, getErrorMessage, loadSettingsProject, saveCurrentProject } from '@/06-shared/api'
import { reportError, type DropdownOption } from '@/06-shared'
import { useLaunchStepsStream } from '@/04-features'

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
    coreStore.clearSessionState()
    accountsStore.loginError = ''
    accountsStore.logins = []
    accountsStore.selectedUsername = ''
    accountsStore.errorMessage = ''
    accountsStore.authError = ''
    accountsStore.loginsError = ''
    accountsStore.isLoginsLoading = false
    accountsStore.loginFormData = { username: '', password: '', rememberMe: false }
    accountsStore.registerFormData = { login: '', password: '', confirmPassword: '' }
    accountsStore.closeAuthForm()
    accountsStore.activeSubTab = 'login'
    accountsStore.isLaunching = false
    resetLaunchSteps()
  }

  const isSwitching = computed((): boolean => accountsStore.isSwitching)

  const applyProjectSwitch = async (projectName: string): Promise<void> => {
    const projectConfig = await loadSettingsProject(projectName)
    const logins = await authLogins(projectName)
    await clearSession()

    coreStore.currentProject = projectName
    coreStore.projectConfig = projectConfig
    resetAccountsState()
    accountsStore.logins = logins
  }

  const restoreSavedProject = async (projectName: string): Promise<void> => {
    if (!projectName) return
    try {
      await saveCurrentProject(projectName)
    } catch (e: unknown) {
      reportError('Не удалось восстановить текущий проект', e)
    }
  }

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

    const previousProject = coreStore.currentProject
    accountsStore.isSwitching = true

    try {
      await saveCurrentProject(projectName)
      await applyProjectSwitch(projectName)
    } catch (e: unknown) {
      if (coreStore.currentProject === previousProject) {
        await restoreSavedProject(previousProject)
      }
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
    applyProjectSwitch,
  }
}
