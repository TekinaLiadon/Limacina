import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountsStore } from '../accountsStore'

describe('useAccountsStore', () => {
  it('starts with an empty login form and no saved logins', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    expect(store.logins).toEqual([])
    expect(store.loginFormData).toEqual({ username: '', password: '', rememberMe: false })
    expect(store.registerFormData).toEqual({
      login: '',
      password: '',
      confirmPassword: '',
    })
    expect(store.isLoginsLoading).toBe(false)
    expect(store.loginsError).toBe('')
    expect(store.authLoading).toBe(false)
    expect(store.authError).toBe('')
  })

  it('starts without an active auth form and logged out', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    expect(store.showAuthForm).toBe(false)
    expect(store.activeSubTab).toBe('login')
    expect(store.selectedUsername).toBe('')
    expect(store.isLoading).toBe(false)
    expect(store.isLoggedIn).toBe(false)
    expect(store.session).toBeNull()
  })

  it('applySession stores the session and marks the user logged in', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    store.applySession({ uuid: 'u1', username: 'Steve' })
    expect(store.session).toEqual({ uuid: 'u1', username: 'Steve' })
    expect(store.isLoggedIn).toBe(true)
  })

  it('clearSessionState resets the session fields together', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    store.applySession({ uuid: 'u1', username: 'Steve' })

    store.clearSessionState()

    expect(store.isLoggedIn).toBe(false)
    expect(store.session).toBeNull()
  })

  it('closes the auth form and wipes the login password', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    store.showAuthForm = true
    store.loginFormData = { username: 'user', password: 'secret', rememberMe: true }

    store.closeAuthForm()

    expect(store.showAuthForm).toBe(false)
    expect(store.loginFormData.password).toBe('')
    expect(store.loginFormData.username).toBe('user')
    expect(store.loginFormData.rememberMe).toBe(true)
  })

  it('closes the auth form and wipes the registration passwords', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    store.showAuthForm = true
    store.registerFormData = { login: 'user', password: 'secret', confirmPassword: 'secret' }

    store.closeAuthForm()

    expect(store.showAuthForm).toBe(false)
    expect(store.registerFormData.login).toBe('user')
    expect(store.registerFormData.password).toBe('')
    expect(store.registerFormData.confirmPassword).toBe('')
  })

  it('resets every accounts field to its initial value', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    store.isLoading = true
    store.errorMessage = 'boom'
    store.logins = ['alice']
    store.loginsError = 'ipc down'
    store.isLoginsLoading = true
    store.selectedUsername = 'alice'
    store.authLoading = true
    store.authError = 'bad credentials'
    store.loginFormData = { username: 'user', password: 'secret', rememberMe: true }
    store.registerFormData = { login: 'user', password: 'secret', confirmPassword: 'secret' }
    store.showAuthForm = true
    store.activeSubTab = 'register'

    store.reset()

    expect(store.isLoading).toBe(false)
    expect(store.errorMessage).toBe('')
    expect(store.logins).toEqual([])
    expect(store.loginsError).toBe('')
    expect(store.isLoginsLoading).toBe(false)
    expect(store.selectedUsername).toBe('')
    expect(store.authLoading).toBe(false)
    expect(store.authError).toBe('')
    expect(store.loginFormData).toEqual({ username: '', password: '', rememberMe: false })
    expect(store.registerFormData).toEqual({
      login: '',
      password: '',
      confirmPassword: '',
    })
    expect(store.showAuthForm).toBe(false)
    expect(store.activeSubTab).toBe('login')
  })

  it('keeps state across accesses within the same pinia', () => {
    setActivePinia(createPinia())
    useAccountsStore().logins = ['alice']
    expect(useAccountsStore().logins).toEqual(['alice'])
  })
})
