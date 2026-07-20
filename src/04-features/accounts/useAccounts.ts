import { computed, onMounted } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authLogins, authRefresh, getSessionInfo } from '@/06-shared/api'

export function useAccounts() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()

  const isLoading = computed({
    get: (): boolean => store.isLoading,
    set: (v: boolean): void => { store.isLoading = v },
  })
  const errorMessage = computed({
    get: (): string => store.errorMessage,
    set: (v: string): void => { store.errorMessage = v },
  })
  const logins = computed({
    get: (): string[] => store.logins,
    set: (v: string[]): void => { store.logins = v },
  })
  const selectedUsername = computed({
    get: (): string => store.selectedUsername,
    set: (v: string): void => { store.selectedUsername = v },
  })

  const loadAccounts = async (): Promise<void> => {
    try {
      store.logins = await authLogins(coreStore.currentProject)
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const checkSession = async (): Promise<void> => {
    try {
      const session = await getSessionInfo()
      if (session) {
        coreStore.session = session
        coreStore.isLoggedIn = true
        store.selectedUsername = session.username
      }
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const handleSelect = async (username: string): Promise<void> => {
    isLoading.value = true
    errorMessage.value = ''
    selectedUsername.value = username

    try {
      const error = await authRefresh(coreStore.currentProject, username)
      if (!error) {
        const session = await getSessionInfo()
        if (session) {
          coreStore.session = session
          coreStore.isLoggedIn = true
        }
      } else {
        errorMessage.value = error
      }
    } catch (e: unknown) {
      errorMessage.value = String(e)
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
