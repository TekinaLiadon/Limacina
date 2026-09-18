import { computed, ref } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore } from '@/05-entities'
import { useAccounts, useGameLaunch, useSystemNotifications } from '@/04-features'
import { clearSession, deleteAccount, getErrorMessage } from '@/06-shared/api'
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

  const { sendSystemNotification } = useSystemNotifications()

  const isServerOffline = computed((): boolean =>
    !coreStore.offlineBuild &&
    coreStore.projectConfig?.online === true &&
    coreStore.isServerReachable === false
  )

  const handleLaunch = async (): Promise<void> => {
    if (store.isLaunching) return
    if (isServerOffline.value) {
      notificationStore.show('Сервер лаунчера недоступен, запуск невозможен')
      void sendSystemNotification('Запуск заблокирован', 'Сервер лаунчера недоступен')
      return
    }
    isCancelPending.value = false
    const launchGeneration = ++store.launchGeneration
    store.isLaunching = true
    try {
      await executeSteps(() => launchGeneration !== store.launchGeneration)
    } catch (e: unknown) {
      if (launchGeneration === store.launchGeneration) {
        coreStore.loginError = getErrorMessage(e)
      }
    } finally {
      if (launchGeneration === store.launchGeneration) {
        store.isLaunching = false
      } else if (isCancelPending.value) {
        await finalizeCancel()
      }
    }
  }

  const hasAccounts = computed((): boolean => logins.value.length > 0)
  const isLaunching = computed((): boolean => store.isLaunching)
  const loginsError = computed((): string => store.loginsError)
  const showAuth = computed((): boolean =>
    !store.isLaunching
    && (store.showAuthForm || (!hasAccounts.value && !coreStore.isLoggedIn && !loginsError.value && !store.isLoginsLoading)),
  )
  const showBack = computed((): boolean => hasAccounts.value || coreStore.isLoggedIn)

  const isSelected = (login: string): boolean => coreStore.isLoggedIn && selectedUsername.value === login

  const launchInterrupted = computed((): boolean => store.launchInterrupted)

  const showLoginForm = (): void => {
    store.showAuthForm = true
    store.activeSubTab = 'login'
  }

  const isCancelPending = ref<boolean>(false)

  const finalizeCancel = async (): Promise<void> => {
    isCancelPending.value = false
    store.isLaunching = false
    store.launchInterrupted = false
    store.showAuthForm = false
    try {
      await clearSession()
    } catch (e: unknown) {
      reportError('Не удалось завершить сессию на стороне лаунчера', e)
    }
    coreStore.isLoggedIn = false
    coreStore.session = null
  }

  const goToAccounts = async (): Promise<void> => {
    store.launchGeneration++
    if (store.isLaunching && !store.launchInterrupted) {
      isCancelPending.value = true
      return
    }
    await finalizeCancel()
  }

  const activeSubTab = computed({
    get: () => store.activeSubTab,
    set: (v) => { store.activeSubTab = v },
  })
  const loginError = computed((): string => coreStore.loginError)
  const sceneUsername = computed((): string => {
    if (coreStore.session?.username) return coreStore.session.username
    if (store.selectedUsername) return store.selectedUsername
    return logins.value[0] ?? ''
  })

  const handleDeleteAccount = async (username: string): Promise<void> => {
    const confirmed = await notificationStore.confirm(`Вы хотите удалить аккаунт ${username}?`)
    if (!confirmed) return

    try {
      await deleteAccount(coreStore.currentProject, username)
      await loadAccounts()
      notificationStore.show('Аккаунт удалён')
    } catch (e: unknown) {
      notificationStore.show(getErrorMessage(e))
    }
  }

  return {
    isLoading,
    errorMessage,
    logins,
    loginsError,
    loadAccounts,
    selectedUsername,
    handleSelect,
    isLaunching,
    showAuth,
    isSelected,
    activeSubTab,
    launchSteps,
    activeProgress,
    launchInterrupted,
    loginError,
    sceneUsername,
    isCancelPending,
    isServerOffline,
    handleLaunch,
    showLoginForm,
    goToAccounts,
    handleDeleteAccount,
    showBack,
  }
}
