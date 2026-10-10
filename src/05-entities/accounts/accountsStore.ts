import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AuthSubTab, LoginForm, RegisterForm, SessionInfo } from '../core/types'
import { AUTH_LOGIN_TAB } from '../core/authPolicy'

export const useAccountsStore = defineStore('accounts', () => {
  const isLoading = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const logins = ref<string[]>([])
  const loginsError = ref<string>('')
  const isLoginsLoading = ref<boolean>(false)
  const selectedUsername = ref<string>('')

  const authLoading = ref<boolean>(false)
  const authError = ref<string>('')
  const loginFormData = ref<LoginForm>({ username: '', password: '', rememberMe: false })
  const registerFormData = ref<RegisterForm>({ login: '', password: '', confirmPassword: '' })

  const isLoggedIn = ref<boolean>(false)
  const session = ref<SessionInfo | null>(null)

  const showAuthForm = ref<boolean>(false)
  const activeSubTab = ref<AuthSubTab>(AUTH_LOGIN_TAB)

  function applySession(nextSession: SessionInfo): void {
    session.value = nextSession
    isLoggedIn.value = true
  }

  function clearSessionState(): void {
    isLoggedIn.value = false
    session.value = null
  }

  function closeAuthForm(): void {
    showAuthForm.value = false
    loginFormData.value.password = ''
    registerFormData.value.password = ''
    registerFormData.value.confirmPassword = ''
  }

  function reset(): void {
    isLoading.value = false
    errorMessage.value = ''
    logins.value = []
    loginsError.value = ''
    isLoginsLoading.value = false
    selectedUsername.value = ''
    authLoading.value = false
    authError.value = ''
    loginFormData.value = { username: '', password: '', rememberMe: false }
    registerFormData.value = { login: '', password: '', confirmPassword: '' }
    closeAuthForm()
    activeSubTab.value = AUTH_LOGIN_TAB
  }

  return {
    isLoading,
    errorMessage,
    logins,
    loginsError,
    isLoginsLoading,
    selectedUsername,
    authLoading,
    authError,
    loginFormData,
    registerFormData,
    isLoggedIn,
    session,
    showAuthForm,
    activeSubTab,
    applySession,
    clearSessionState,
    closeAuthForm,
    reset,
  }
})
