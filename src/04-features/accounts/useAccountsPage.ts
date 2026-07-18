import { ref, computed } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { useAccounts, useGameLaunch } from '@/04-features'
import { deleteAccount } from '@/06-shared/api'
import type { AuthSubTab } from '@/05-entities/core/types'

export function useAccountsPage() {
  const coreStore = useCoreStore()
  const notificationStore = useNotificationStore()

  const {
    isLoading,
    errorMessage,
    logins,
    selectedUsername,
    handleSelect,
    loadAccounts,
  } = useAccounts()

  const {
    launchSteps,
    activeProgress,
    executeSteps,
  } = useGameLaunch()

  const showAuthForm = ref<boolean>(false)
  const activeSubTab = ref<AuthSubTab>('login')
  const isLaunching = ref<boolean>(false)

  const hasAccounts = computed((): boolean => logins.value.length > 0)
  const showAccountList = computed((): boolean => hasAccounts.value && !coreStore.isLoggedIn && !showAuthForm.value && !isLaunching.value)
  const showCurrentAccount = computed((): boolean => coreStore.isLoggedIn && !showAuthForm.value && !isLaunching.value)
  const showLaunchProgress = computed((): boolean => isLaunching.value)
  const showAuthTabs = computed((): boolean => !showAccountList.value && !showCurrentAccount.value && !showLaunchProgress.value)
  const showBack = computed((): boolean => hasAccounts.value || coreStore.isLoggedIn)

  const isSelected = (login: string): boolean => coreStore.isLoggedIn && selectedUsername.value === login

  const handleLaunch = async (): Promise<void> => {
    isLaunching.value = true
    await executeSteps()
  }

  const showLoginForm = (): void => {
    showAuthForm.value = true
    activeSubTab.value = 'login'
  }

  const goToAccounts = (): void => {
    coreStore.isLoggedIn = false
    coreStore.session = null
    showAuthForm.value = false
  }

  const handleDeleteAccount = async (username: string): Promise<void> => {
    const confirmed = await notificationStore.confirm(`Вы хотите удалить аккаунт ${username}?`)
    if (!confirmed) return

    try {
      await deleteAccount(coreStore.currentProject, username)
      await loadAccounts()
      notificationStore.show('Аккаунт удалён')
    } catch (e: unknown) {
      notificationStore.show(String(e))
    }
  }

  return {
    isLoading,
    errorMessage,
    logins,
    selectedUsername,
    handleSelect,
    showAccountList,
    showCurrentAccount,
    showLaunchProgress,
    showAuthTabs,
    isSelected,
    activeSubTab,
    launchSteps,
    activeProgress,
    loginError: computed((): string => coreStore.loginError),
    sessionUsername: computed((): string => coreStore.session?.username ?? ''),
    handleLaunch,
    showLoginForm,
    goToAccounts,
    handleDeleteAccount,
    showBack,
  }
}
