import { onMounted } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authRefresh, getErrorMessage, getSessionInfo } from '@/06-shared/api'
import { reportError, storeBinding } from '@/06-shared'
import { useAccountsList } from './useAccountsList'

export function useAccounts() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()
  const { logins, loadAccounts } = useAccountsList()

  const isLoading = storeBinding(store, 'isLoading')
  const errorMessage = storeBinding(store, 'errorMessage')
  const selectedUsername = storeBinding(store, 'selectedUsername')

  const checkSession = async (): Promise<void> => {
    const projectName = coreStore.currentProject
    try {
      const session = await getSessionInfo()
      if (coreStore.currentProject !== projectName) return
      if (!session) return
      coreStore.applySession(session)
      store.selectedUsername = session.username
    } catch (e: unknown) {
      reportError('Не удалось проверить сессию', e)
    }
  }

  const handleSelect = async (username: string): Promise<void> => {
    if (isLoading.value) return
    isLoading.value = true
    errorMessage.value = ''
    const projectName = coreStore.currentProject
    const previousUsername = selectedUsername.value
    selectedUsername.value = username

    try {
      await authRefresh(projectName, username)
      const session = await getSessionInfo()
      if (coreStore.currentProject !== projectName) return
      if (session) coreStore.applySession(session)
    } catch (e: unknown) {
      if (coreStore.currentProject !== projectName) return
      selectedUsername.value = previousUsername
      errorMessage.value = getErrorMessage(e)
    } finally {
      if (coreStore.currentProject === projectName) isLoading.value = false
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
