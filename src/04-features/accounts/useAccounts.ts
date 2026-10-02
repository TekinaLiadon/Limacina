import { onMounted } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authRefresh, getErrorMessage, getSessionInfo } from '@/06-shared/api'
import { reportError, storeBinding, useAsyncRaceGuard } from '@/06-shared'
import { useAccountsList } from './useAccountsList'

export function useAccounts() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()
  const { logins, loadAccounts } = useAccountsList()

  const isLoading = storeBinding(store, 'isLoading')
  const errorMessage = storeBinding(store, 'errorMessage')
  const selectedUsername = storeBinding(store, 'selectedUsername')

  const checkSession = async (): Promise<void> => {
    try {
      const session = await getSessionInfo()
      if (session) {
        coreStore.applySession(session)
        store.selectedUsername = session.username
      }
    } catch (e: unknown) {
      reportError('Не удалось проверить сессию', e)
    }
  }

  const restoreFirstAccount = async (): Promise<void> => {
    if (coreStore.isLoggedIn || selectedUsername.value) return
    const [firstLogin] = logins.value
    if (firstLogin === undefined) return
    await handleSelect(firstLogin)
  }

  const restoreSession = async (): Promise<void> => {
    await loadAccounts()
    await checkSession()
    await restoreFirstAccount()
  }

  const sessionGuard = useAsyncRaceGuard()

  const handleSelect = async (username: string): Promise<void> => {
    if (isLoading.value) return
    isLoading.value = true
    errorMessage.value = ''
    const previousUsername = selectedUsername.value
    selectedUsername.value = username
    const generation = sessionGuard.next()

    try {
      await authRefresh(coreStore.currentProject, username)
      const session = await getSessionInfo()
      if (!sessionGuard.isCurrent(generation)) return
      if (session) coreStore.applySession(session)
    } catch (e: unknown) {
      if (!sessionGuard.isCurrent(generation)) return
      selectedUsername.value = previousUsername
      errorMessage.value = getErrorMessage(e)
      coreStore.clearSessionState()
    } finally {
      if (sessionGuard.isCurrent(generation)) isLoading.value = false
    }
  }

  onMounted(() => {
    void restoreSession()
  })

  return {
    isLoading,
    errorMessage,
    logins,
    selectedUsername,
    handleSelect,
    loadAccounts,
    restoreSession,
  }
}
