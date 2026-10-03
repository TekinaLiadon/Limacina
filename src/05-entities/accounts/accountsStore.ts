import { defineStore } from 'pinia'
import type { AuthSubTab, LoginForm, RegisterForm } from '../core/types'

export interface AccountsState {
  isLoading: boolean
  errorMessage: string
  logins: string[]
  loginsError: string
  isLoginsLoading: boolean
  selectedUsername: string

  authLoading: boolean
  authError: string
  loginFormData: LoginForm
  registerFormData: RegisterForm

  showAuthForm: boolean
  activeSubTab: AuthSubTab
  isSwitching: boolean
}

export const useAccountsStore = defineStore('accounts', {
  state: (): AccountsState => ({
    isLoading: false,
    errorMessage: '',
    logins: [],
    loginsError: '',
    isLoginsLoading: false,
    selectedUsername: '',

    authLoading: false,
    authError: '',
    loginFormData: {
      username: '',
      password: '',
      rememberMe: false,
    },
    registerFormData: {
      login: '',
      password: '',
      confirmPassword: '',
    },

    showAuthForm: false,
    activeSubTab: 'login' as AuthSubTab,
    isSwitching: false,
  }),
  actions: {
    closeAuthForm(): void {
      this.showAuthForm = false
      this.loginFormData.password = ''
    },

    reset(): void {
      this.isLoading = false
      this.errorMessage = ''
      this.logins = []
      this.loginsError = ''
      this.isLoginsLoading = false
      this.selectedUsername = ''
      this.authLoading = false
      this.authError = ''
      this.loginFormData = { username: '', password: '', rememberMe: false }
      this.registerFormData = { login: '', password: '', confirmPassword: '' }
      this.closeAuthForm()
      this.activeSubTab = 'login'
    },
  },
})
