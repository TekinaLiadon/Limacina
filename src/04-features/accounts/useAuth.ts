import { computed, onMounted } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore } from '@/05-entities'
import { authLogins, authSaved, authLogin, authRegister } from '@/06-shared/api'
import type { AuthUserData } from '@/05-entities/core/types'

export function useAuth() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const store = useAccountsStore()

  const isLoading = computed({
    get: (): boolean => store.authLoading,
    set: (v: boolean): void => { store.authLoading = v },
  })
  const errorMessage = computed({
    get: (): string => store.authError,
    set: (v: string): void => { store.authError = v },
  })
  const logins = computed({
    get: (): string[] => store.logins,
    set: (v: string[]): void => { store.logins = v },
  })

  const loginFormData = computed({
    get: () => store.loginFormData,
    set: (v) => { store.loginFormData = v },
  })
  const registerFormData = computed({
    get: () => store.registerFormData,
    set: (v) => { store.registerFormData = v },
  })
  const showRegisterForm = computed({
    get: (): boolean => store.registerShowForm,
    set: (v: boolean): void => { store.registerShowForm = v },
  })

  const passwordsMatch = computed((): boolean => {
    if (!store.registerFormData.confirmPassword) return true
    return store.registerFormData.password === store.registerFormData.confirmPassword
  })

  const isRegisterValid = computed((): boolean => {
    return (
      store.registerFormData.login.length > 0 &&
      store.registerFormData.password.length > 0 &&
      store.registerFormData.confirmPassword.length > 0 &&
      passwordsMatch.value
    )
  })

  const loadAccounts = async (): Promise<void> => {
    try {
      store.logins = await authLogins(coreStore.currentProject)
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const loadSavedCredentials = async (): Promise<void> => {
    if (coreStore.isLoggedIn) return

    try {
      store.logins = await authLogins(coreStore.currentProject)
      const saved = await authSaved(coreStore.currentProject)
      if (!saved) return

      store.loginFormData.username = saved.username
      store.loginFormData.password = saved.password
      store.loginFormData.rememberMe = true
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const handleLogin = async (): Promise<void> => {
    isLoading.value = true
    errorMessage.value = ''

    try {
      const authData: AuthUserData = {
        projectName: coreStore.currentProject,
        username: store.loginFormData.username,
        password: store.loginFormData.password,
        rememberMe: store.loginFormData.rememberMe,
      }
      await authLogin(authData)
      coreStore.isLoggedIn = true
      notification.show('Авторизация прошла успешно')
    } catch (e: unknown) {
      console.error(e)
      errorMessage.value = String(e)
    } finally {
      isLoading.value = false
    }
  }

  const handleRegister = async (): Promise<void> => {
    if (!isRegisterValid.value) return

    isLoading.value = true
    errorMessage.value = ''

    try {
      await authRegister(
        coreStore.currentProject,
        store.registerFormData.login,
        store.registerFormData.password
      )

      notification.show('Аккаунт успешно создан. Ожидайте одобрения администратора.')
      showRegisterForm.value = false
      store.registerFormData = { login: '', password: '', confirmPassword: '' }
      await loadAccounts()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    } finally {
      isLoading.value = false
    }
  }

  const openRegisterForm = (): void => {
    showRegisterForm.value = true
    errorMessage.value = ''
    store.registerFormData = { login: '', password: '', confirmPassword: '' }
  }

  const closeRegisterForm = (): void => {
    showRegisterForm.value = false
    errorMessage.value = ''
  }

  onMounted(loadSavedCredentials)

  return {
    isLoading,
    errorMessage,
    logins,
    loginFormData,
    registerFormData,
    showRegisterForm,
    passwordsMatch,
    isRegisterValid,
    handleLogin,
    handleRegister,
    openRegisterForm,
    closeRegisterForm,
  }
}
