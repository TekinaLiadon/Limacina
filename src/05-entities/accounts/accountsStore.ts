import { defineStore } from 'pinia'
import type { AuthSubTab, LoginForm, RegisterForm, StepProgressItem } from '../core/types'

export interface AccountsState {
  isLoading: boolean
  errorMessage: string
  logins: string[]
  loginsError: string
  isLoginsLoading: boolean
  selectedUsername: string

  authLoading: boolean
  authError: string
  loginError: string
  loginFormData: LoginForm
  registerFormData: RegisterForm

  showAuthForm: boolean
  activeSubTab: AuthSubTab
  isLaunching: boolean
  launchInterrupted: boolean
  isCancelPending: boolean
  isSwitching: boolean
  launchGeneration: number

  launchSteps: StepProgressItem[]
  activeProgress: number
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
    loginError: '',
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
    isLaunching: false,
    launchInterrupted: false,
    isCancelPending: false,
    isSwitching: false,
    launchGeneration: 0,

    launchSteps: [],
    activeProgress: 0,
  }),
  actions: {
    closeAuthForm(): void {
      this.showAuthForm = false
      this.loginFormData.password = ''
    },
  },
})
