import { computed } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore } from '@/05-entities'
import { useAccounts, useGameLaunch } from '@/04-features'
import { deleteAccount, logoutAccount } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useAccountsPage() {
  const coreStore = useCoreStore()
  const notificationStore = useNotificationStore()
  const store = useAccountsStore()

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

  const handleLaunch = async (): Promise<void> => {
    const launchGeneration = ++store.launchGeneration
    store.isLaunching = true
    try {
      await executeSteps(() => launchGeneration !== store.launchGeneration)
    } catch (e: unknown) {
      coreStore.loginError = String(e)
    } finally {
      if (launchGeneration === store.launchGeneration) {
        store.isLaunching = false
      }
    }
  }

  const hasAccounts = computed((): boolean => logins.value.length > 0)
  const showAccountList = computed((): boolean => hasAccounts.value && !coreStore.isLoggedIn && !store.showAuthForm && !store.isLaunching)
  const showCurrentAccount = computed((): boolean => coreStore.isLoggedIn && !store.showAuthForm && !store.isLaunching)
  const showLaunchProgress = computed((): boolean => store.isLaunching)
  const showAuthTabs = computed((): boolean => !showAccountList.value && !showCurrentAccount.value && !showLaunchProgress.value)
  const showBack = computed((): boolean => hasAccounts.value || coreStore.isLoggedIn)

  const isSelected = (login: string): boolean => coreStore.isLoggedIn && selectedUsername.value === login

  const showLoginForm = (): void => {
    store.showAuthForm = true
    store.activeSubTab = 'login'
  }

  const goToAccounts = async (): Promise<void> => {
    store.launchGeneration++
    store.isLaunching = false
    store.showAuthForm = false
    try {
      await logoutAccount()
    } catch (e: unknown) {
      reportError('Не удалось завершить сессию на стороне лаунчера', e)
    }
    coreStore.isLoggedIn = false
    coreStore.session = null
  }

  const activeSubTab = computed({
    get: () => store.activeSubTab,
    set: (v) => { store.activeSubTab = v },
  })
  const loginError = computed((): string => coreStore.loginError)
  const sessionUsername = computed((): string => coreStore.session?.username ?? '')

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
    loginError,
    sessionUsername,
    handleLaunch,
    showLoginForm,
    goToAccounts,
    handleDeleteAccount,
    showBack,
  }
}
