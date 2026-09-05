import { defineStore } from 'pinia'
import type { AuthSubTab, LoginForm, RegisterForm, StepProgressItem } from '../core/types'

export interface AccountsState {
  isLoading: boolean
  errorMessage: string
  logins: string[]
  selectedUsername: string

  authLoading: boolean
  authError: string
  loginFormData: LoginForm
  registerFormData: RegisterForm
  registerShowForm: boolean

  showAuthForm: boolean
  activeSubTab: AuthSubTab
  isLaunching: boolean
  launchGeneration: number

  launchSteps: StepProgressItem[]
  activeProgress: number
}

export const useAccountsStore = defineStore('accounts', {
  state: (): AccountsState => ({
    isLoading: false,
    errorMessage: '',
    logins: [],
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
    registerShowForm: false,

    showAuthForm: false,
    activeSubTab: 'login' as AuthSubTab,
    isLaunching: false,
    launchGeneration: 0,

    launchSteps: [],
    activeProgress: 0,
  }),
})
