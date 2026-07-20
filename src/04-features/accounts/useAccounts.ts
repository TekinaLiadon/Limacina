import { ref, onMounted } from 'vue'
import { useCoreStore } from '@/05-entities'
import { authLogins, authRefresh, getSessionInfo } from '@/06-shared/api'

export function useAccounts() {
  const coreStore = useCoreStore()
  const isLoading = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const logins = ref<string[]>([])
  const selectedUsername = ref<string>('')

  const loadAccounts = async (): Promise<void> => {
    try {
      logins.value = await authLogins(coreStore.currentProject)
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
        selectedUsername.value = session.username
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
