import { computed } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore, useLaunchStore, AUTH_LOGIN_TAB } from '@/05-entities'
import { useAccounts } from '@/04-features/accounts/useAccounts'
import { useGameLaunch } from '@/04-features/game-launch/useGameLaunch'
import { useLaunchStepsStream } from '@/04-features/game-launch/useLaunchStepsStream'
import { isIntegrityCheckRunning } from '@/04-features/integrity-check/useIntegrityCheck'
import { deleteAccount, getErrorMessage, getGameState } from '@/06-shared/api'
import { reportError, storeBinding } from '@/06-shared'
import { finalizeSession } from './finalizeSession'

export function useAccountsPage() {
  const coreStore = useCoreStore()
  const notificationStore = useNotificationStore()
  const store = useAccountsStore()
  const launch = useLaunchStore()

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

  const { resetLaunchSteps } = useLaunchStepsStream()

  const isServerOffline = computed((): boolean =>
    coreStore.isOnlineProject && coreStore.isServerReachable === false
  )

  const handleLaunch = async (): Promise<void> => {
    if (launch.isLaunching) return
    if (coreStore.gameUsername !== null) {
      notificationStore.show('Игра уже запущена')
      return
    }
    if (isServerOffline.value) {
      notificationStore.show('Сервер лаунчера недоступен, запуск невозможен')
      return
    }
    if (isIntegrityCheckRunning()) {
      notificationStore.show('Идёт проверка целостности, запуск невозможен')
      return
    }
    const launchGeneration = launch.beginLaunch()
    try {
      try {
        const username = await getGameState()
        if (username !== null) {
          coreStore.gameUsername = username
          notificationStore.show('Игра уже запущена')
          return
        }
      } catch (e: unknown) {
        reportError('Не удалось проверить состояние игровой сессии', e)
        notificationStore.show('Не удалось проверить состояние игры, запуск заблокирован')
        return
      }
      await executeSteps(() => !launch.isCurrent(launchGeneration))
    } catch (e: unknown) {
      launch.reportFailure(launchGeneration, getErrorMessage(e))
    } finally {
      if (launch.isCurrent(launchGeneration)) {
        launch.finishLaunch()
      } else if (launch.isCancelPending) {
        await finalizeCancel()
      }
    }
  }

  const hasAccounts = computed((): boolean => logins.value.length > 0)
  const isLaunching = computed((): boolean => launch.isLaunching)
  const loginsError = computed((): string => store.loginsError)
  const showAuth = computed((): boolean =>
    !launch.isLaunching
    && !store.isLoginsLoading
    && (store.showAuthForm || (!hasAccounts.value && !coreStore.isLoggedIn && !loginsError.value)),
  )
  const showBack = computed((): boolean => hasAccounts.value || coreStore.isLoggedIn)

  const launchInterrupted = computed((): boolean => launch.launchInterrupted)
  const isCancelPending = computed((): boolean => launch.isCancelPending)

  const showLoginForm = (): void => {
    store.showAuthForm = true
    store.activeSubTab = AUTH_LOGIN_TAB
  }

  const finalizeCancel = async (): Promise<void> => {
    resetLaunchSteps()
    launch.cancelLaunch()
    store.closeAuthForm()
    await finalizeSession()
  }

  const goToAccounts = async (): Promise<void> => {
    launch.invalidateGeneration()
    if (launch.isLaunching && !launch.launchInterrupted) {
      launch.setCancelPending(true)
      return
    }
    if (launch.isLaunching || launch.launchInterrupted) {
      await finalizeCancel()
      return
    }
    store.closeAuthForm()
  }

  const activeSubTab = storeBinding(store, 'activeSubTab')
  const loginError = computed((): string => launch.loginError)
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
        await finalizeSession()
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
