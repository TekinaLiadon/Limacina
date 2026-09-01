import { computed } from 'vue'
import { useAccountsStore, useCoreStore, useNotificationStore } from '@/05-entities'
import { authLogins, loadSettingsProject, logoutAccount, saveCurrentProject } from '@/06-shared/api'
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

  const selectProject = async (projectName: string): Promise<void> => {
    if (!projectName || projectName === coreStore.currentProject) return

    coreStore.currentProject = projectName
    coreStore.projectConfig = null
    resetAccountsState()

    try {
      await logoutAccount()
      await saveCurrentProject(projectName)
      coreStore.projectConfig = await loadSettingsProject(projectName)
      accountsStore.logins = await authLogins(projectName)
    } catch (e: unknown) {
      notification.show(String(e))
    }
  }

  return {
    projectOptions,
    canSwitch,
    resetAccountsState,
    selectProject,
  }
}
