import { onMounted } from 'vue'
import { useCoreStore, useAccountsStore, useLaunchStore, AUTH_LOGIN_TAB } from '@/05-entities'
import { authRefresh, getCommandError, getErrorMessage, getSessionInfo, AUTH_NO_SAVED_CREDENTIALS_CODE } from '@/06-shared/api'
import { captureProjectScope, refreshSession, reportError, storeBinding } from '@/06-shared'
import { useAccountsList } from './useAccountsList'

export function useAccounts() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()
  const launch = useLaunchStore()
  const { logins, loadAccounts } = useAccountsList()

  const isLoading = storeBinding(store, 'isLoading')
  const errorMessage = storeBinding(store, 'errorMessage')
  const selectedUsername = storeBinding(store, 'selectedUsername')

  const checkSession = async (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    await refreshSession(scope, (session): void => {
      store.applySession(session)
      store.selectedUsername = session.username
    }, 'Не удалось проверить сессию')
  }

  const handleSelect = async (username: string): Promise<void> => {
    if (isLoading.value) return
    launch.clearLoginError()
    isLoading.value = true
    errorMessage.value = ''
    const scope = captureProjectScope((): string => coreStore.currentProject)
    const previousUsername = selectedUsername.value
    selectedUsername.value = username

    try {
      await authRefresh(scope.project, username)
      try {
        const session = await getSessionInfo()
        if (!scope.isCurrent()) return
        if (session) store.applySession(session)
      } catch (e: unknown) {
        if (!scope.isCurrent()) return
        reportError('Не удалось загрузить сессию аккаунта', e)
        store.clearSessionState()
        errorMessage.value = getErrorMessage(e)
      }
    } catch (e: unknown) {
      if (!scope.isCurrent()) return
      reportError('Не удалось выбрать аккаунт', e)
      selectedUsername.value = previousUsername
      errorMessage.value = getErrorMessage(e)
      if (getCommandError(e).code === AUTH_NO_SAVED_CREDENTIALS_CODE) {
        store.showAuthForm = true
        store.activeSubTab = AUTH_LOGIN_TAB
        store.loginFormData.username = username
        store.authError = errorMessage.value
      }
    } finally {
      if (scope.isCurrent()) isLoading.value = false
    }
  }

  onMounted(() => {
    loadAccounts()
    checkSession()
  })

  return {
    isLoading,
    errorMessage,
    logins,
    selectedUsername,
    handleSelect,
    loadAccounts,
  }
}
