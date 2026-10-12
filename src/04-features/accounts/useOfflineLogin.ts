import { computed, type ComputedRef } from 'vue'
import { useCoreStore, useAccountsStore, MIN_LOGIN_LENGTH } from '@/05-entities'

export interface OfflineLoginSource {
  isLoginValid: ComputedRef<boolean>
  submitLogin: () => Promise<void>
}

export function useOfflineLogin({ isLoginValid: serverLoginValid, submitLogin }: OfflineLoginSource): {
  isOffline: ComputedRef<boolean>
  isLoginValid: ComputedRef<boolean>
  handleLogin: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const store = useAccountsStore()

  const isOffline = computed((): boolean => coreStore.isOfflineProject)

  const isLoginValid = computed((): boolean => {
    if (!isOffline.value) return serverLoginValid.value
    if (!coreStore.currentProject) return false
    return store.loginFormData.username.length >= MIN_LOGIN_LENGTH
  })

  const handleLogin = async (): Promise<void> => {
    if (!isLoginValid.value) return
    await submitLogin()
  }

  return { isOffline, isLoginValid, handleLogin }
}
