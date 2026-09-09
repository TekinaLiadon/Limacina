import { computed, onMounted } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore } from '@/05-entities'
import { authLogins, authLogin, authRegister, getSessionInfo } from '@/06-shared/api'
import { reportError } from '@/06-shared'
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

  const isOffline = computed((): boolean => coreStore.projectConfig?.online === false)

  const isLoginValid = computed((): boolean => {
    if (store.loginFormData.username.length < 3) return false
    return isOffline.value || store.loginFormData.password.length >= 4
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
      reportError('Не удалось загрузить аккаунты', e)
    }
  }

  const loadSavedCredentials = async (): Promise<void> => {
    if (coreStore.isLoggedIn) return

    try {
      const logins = await authLogins(coreStore.currentProject)
      store.logins = logins
      if (logins.length > 0 && !store.loginFormData.username) {
        store.loginFormData.username = logins[0]
      }
    } catch (e: unknown) {
      reportError('Не удалось загрузить сохранённые учётные данные', e)
    }
  }

  const handleLogin = async (): Promise<void> => {
    if (!isLoginValid.value) return

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

      const session = await getSessionInfo()
      if (session) {
        coreStore.session = session
      }

      await loadAccounts()
      store.showAuthForm = false
      notification.show('Авторизация прошла успешно')
    } catch (e: unknown) {
      reportError('Ошибка авторизации', e)
      errorMessage.value = String(e)
    } finally {
      isLoading.value = false
    }
  }

  const handleRegister = async (): Promise<void> => {
    if (!isRegisterValid.value) return

    isLoading.value = true
    errorMessage.value = ''

    const login = store.registerFormData.login
    const password = store.registerFormData.password

    try {
      await authRegister(
        coreStore.currentProject,
        login,
        password
      )

      notification.show('Аккаунт успешно создан. Ожидайте одобрения администратора.')
      await loadAccounts()

      store.registerFormData = { login: '', password: '', confirmPassword: '' }
      store.showAuthForm = false
      store.registerShowForm = false
      store.activeSubTab = 'login'
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
    isOffline,
    isLoginValid,
    isRegisterValid,
    handleLogin,
    handleRegister,
    openRegisterForm,
    closeRegisterForm,
  }
}
