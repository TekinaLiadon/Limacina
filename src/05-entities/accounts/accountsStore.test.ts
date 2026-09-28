import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAccountsStore } from './accountsStore'

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

  it('starts without an active launch or auth form', () => {
    setActivePinia(createPinia())
    const store = useAccountsStore()
    expect(store.showAuthForm).toBe(false)
    expect(store.activeSubTab).toBe('login')
    expect(store.isLaunching).toBe(false)
    expect(store.launchInterrupted).toBe(false)
    expect(store.isCancelPending).toBe(false)
    expect(store.isSwitching).toBe(false)
    expect(store.launchGeneration).toBe(0)
    expect(store.launchSteps).toEqual([])
    expect(store.activeProgress).toBe(0)
    expect(store.selectedUsername).toBe('')
  })

  it('keeps state across accesses within the same pinia', () => {
    setActivePinia(createPinia())
    useAccountsStore().logins = ['alice']
    expect(useAccountsStore().logins).toEqual(['alice'])
  })
})
