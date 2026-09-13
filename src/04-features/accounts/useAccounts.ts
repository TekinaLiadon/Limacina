import { computed, onMounted } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authRefresh, getSessionInfo } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { useAccountsList } from './useAccountsList'

export function useAccounts() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()
  const { logins, loadAccounts } = useAccountsList()

  const isLoading = computed({
    get: (): boolean => store.isLoading,
    set: (v: boolean): void => { store.isLoading = v },
  })
  const errorMessage = computed({
    get: (): string => store.errorMessage,
    set: (v: string): void => { store.errorMessage = v },
  })
  const selectedUsername = computed({
    get: (): string => store.selectedUsername,
    set: (v: string): void => { store.selectedUsername = v },
  })

  const checkSession = async (): Promise<void> => {
    try {
      const session = await getSessionInfo()
      if (session) {
        coreStore.session = session
        coreStore.isLoggedIn = true
        store.selectedUsername = session.username
      }
    } catch (e: unknown) {
      reportError('Не удалось проверить сессию', e)
    }
  }

  const handleSelect = async (username: string): Promise<void> => {
    isLoading.value = true
    errorMessage.value = ''
    const previousUsername = selectedUsername.value
    selectedUsername.value = username

    try {
      await authRefresh(coreStore.currentProject, username)
      const session = await getSessionInfo()
      if (session) {
        coreStore.session = session
        coreStore.isLoggedIn = true
      }
    } catch (e: unknown) {
      selectedUsername.value = previousUsername
      errorMessage.value = e instanceof Error ? e.message : String(e)
      coreStore.isLoggedIn = false
      coreStore.session = null
    } finally {
      isLoading.value = false
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
