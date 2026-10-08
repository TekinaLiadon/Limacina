import { computed, onMounted } from 'vue'
import { useCoreStore, useNotificationStore, useAccountsStore, MIN_LOGIN_LENGTH, MIN_PASSWORD_LENGTH, isPasswordConfirmed, minLengthMessage, AUTH_LOGIN_TAB } from '@/05-entities'
import { authLogin, authRegister, getErrorMessage, getSessionInfo } from '@/06-shared/api'
import { reportError, storeBinding } from '@/06-shared'
import { useAccountsList } from './useAccountsList'

export function useAuth() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const store = useAccountsStore()
  const { logins, loadAccounts } = useAccountsList()

  const isLoading = storeBinding(store, 'authLoading')
  const errorMessage = storeBinding(store, 'authError')

  const loginFormData = storeBinding(store, 'loginFormData')
  const registerFormData = storeBinding(store, 'registerFormData')

  const passwordsMatch = computed((): boolean =>
    isPasswordConfirmed(store.registerFormData.password, store.registerFormData.confirmPassword)
  )

  const isOffline = computed((): boolean => coreStore.isOfflineProject)

  const isLoginValid = computed((): boolean => {
    if (!coreStore.currentProject) return false
    if (store.loginFormData.username.length < MIN_LOGIN_LENGTH) return false
    return isOffline.value || store.loginFormData.password.length >= MIN_PASSWORD_LENGTH
  })

  const isRegisterValid = computed((): boolean => {
    if (!coreStore.currentProject) return false
    return (
      store.registerFormData.login.length >= MIN_LOGIN_LENGTH &&
      store.registerFormData.password.length >= MIN_PASSWORD_LENGTH &&
      store.registerFormData.confirmPassword.length > 0 &&
      passwordsMatch.value
    )
  })

  const registerLoginHint = computed((): string | null => {
    const { login } = store.registerFormData
    if (!login || login.length >= MIN_LOGIN_LENGTH) return null
    return `Логин — ${minLengthMessage(MIN_LOGIN_LENGTH)}`
  })

  const registerPasswordHint = computed((): string | null => {
    const { password } = store.registerFormData
    if (!password || password.length >= MIN_PASSWORD_LENGTH) return null
    return `Пароль — ${minLengthMessage(MIN_PASSWORD_LENGTH)}`
  })

  const loadSavedCredentials = (): void => {
    if (coreStore.isLoggedIn) return

    const [firstLogin] = store.logins
    if (firstLogin !== undefined && !store.loginFormData.username) {
      store.loginFormData.username = firstLogin
    }
  }

  const clearError = (): void => {
    errorMessage.value = ''
  }

  const reportAuthError = (e: unknown): void => {
    reportError('Ошибка авторизации', e)
    errorMessage.value = getErrorMessage(e)
  }

  const handleLogin = async (): Promise<void> => {
    if (!isLoginValid.value || isLoading.value) return

    isLoading.value = true
    errorMessage.value = ''
    const projectName = coreStore.currentProject

    try {
      await authLogin(
        projectName,
        store.loginFormData.username,
        store.loginFormData.password,
        store.loginFormData.rememberMe
      )
      if (coreStore.currentProject !== projectName) return

      try {
        const session = await getSessionInfo()
        if (session) coreStore.applySession(session)
      } catch (e: unknown) {
        reportError('Не удалось обновить сессию после входа', e)
      }

      await loadAccounts()
      if (coreStore.currentProject !== projectName) return
      store.closeAuthForm()
      notification.show('Авторизация прошла успешно')
    } catch (e: unknown) {
      if (coreStore.currentProject !== projectName) return
      reportAuthError(e)
    } finally {
      isLoading.value = false
    }
  }

  const handleRegister = async (): Promise<void> => {
    if (!isRegisterValid.value || isLoading.value) return

    isLoading.value = true
    errorMessage.value = ''
    const projectName = coreStore.currentProject

    const {login} = store.registerFormData
    const {password} = store.registerFormData

    try {
      await authRegister(
        projectName,
        login,
        password
      )
      if (coreStore.currentProject !== projectName) return

      notification.show('Аккаунт успешно создан. Ожидайте одобрения администратора.')
      await loadAccounts()
      if (coreStore.currentProject !== projectName) return

      store.registerFormData = { login: '', password: '', confirmPassword: '' }
      store.closeAuthForm()
      store.activeSubTab = AUTH_LOGIN_TAB
    } catch (e: unknown) {
      if (coreStore.currentProject !== projectName) return
      reportAuthError(e)
    } finally {
      isLoading.value = false
    }
  }

  onMounted(loadSavedCredentials)

  return {
    isLoading,
    errorMessage,
    clearError,
    logins,
    loginFormData,
    registerFormData,
    passwordsMatch,
    isOffline,
    isLoginValid,
    isRegisterValid,
    registerLoginHint,
    registerPasswordHint,
    handleLogin,
    handleRegister,
  }
}
