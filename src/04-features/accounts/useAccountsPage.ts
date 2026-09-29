import { computed } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore } from '@/05-entities'
import { useAccounts, useGameLaunch, useLaunchStepsStream, useSystemNotifications } from '@/04-features'
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
  const { resetLaunchSteps } = useLaunchStepsStream()

  const isServerOffline = computed((): boolean =>
    coreStore.isOnlineProject && coreStore.isServerReachable === false
  )

  const handleLaunch = async (): Promise<void> => {
    if (store.isLaunching) return
    if (isServerOffline.value) {
      notificationStore.show('Сервер лаунчера недоступен, запуск невозможен')
      void sendSystemNotification('Запуск заблокирован', 'Сервер лаунчера недоступен')
      return
    }
    store.isCancelPending = false
    const launchGeneration = ++store.launchGeneration
    store.isLaunching = true
    try {
      await executeSteps(() => launchGeneration !== store.launchGeneration)
    } catch (e: unknown) {
      if (launchGeneration === store.launchGeneration) {
        store.loginError = getErrorMessage(e)
      }
    } finally {
      if (launchGeneration === store.launchGeneration) {
        store.isLaunching = false
      } else if (store.isCancelPending) {
        await finalizeCancel()
      }
    }
  }

  const hasAccounts = computed((): boolean => logins.value.length > 0)
  const isLaunching = computed((): boolean => store.isLaunching)
  const loginsError = computed((): string => store.loginsError)
  const showAuth = computed((): boolean =>
    !store.isLaunching
    && !store.isLoginsLoading
    && (store.showAuthForm || (!hasAccounts.value && !coreStore.isLoggedIn && !loginsError.value)),
  )
  const showBack = computed((): boolean => hasAccounts.value || coreStore.isLoggedIn)

  const launchInterrupted = computed((): boolean => store.launchInterrupted)
  const isCancelPending = computed((): boolean => store.isCancelPending)

  const showLoginForm = (): void => {
    store.showAuthForm = true
    store.activeSubTab = 'login'
  }

  const finalizeCancel = async (): Promise<void> => {
    resetLaunchSteps()
    store.isCancelPending = false
    store.isLaunching = false
    store.closeAuthForm()
    store.loginError = ''
    try {
      await clearSession()
    } catch (e: unknown) {
      reportError('Не удалось завершить сессию на стороне лаунчера', e)
    }
    coreStore.clearSessionState()
  }

  const goToAccounts = async (): Promise<void> => {
    store.launchGeneration++
    if (store.isLaunching && !store.launchInterrupted) {
      store.isCancelPending = true
      return
    }
    if (store.isLaunching || store.launchInterrupted) {
      await finalizeCancel()
      return
    }
    store.closeAuthForm()
  }

  const activeSubTab = computed({
    get: () => store.activeSubTab,
    set: (v) => { store.activeSubTab = v },
  })
  const loginError = computed((): string => store.loginError)
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
      if (coreStore.session?.username === username) {
        try {
          await clearSession()
        } catch (e: unknown) {
          reportError('Не удалось завершить сессию на стороне лаунчера', e)
        }
        coreStore.clearSessionState()
        store.selectedUsername = ''
      }
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
