import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authLogins, authRefresh, getSessionInfo } from '@/06-shared/api'
import { AUTH_LOGIN_TAB, useAccountsStore, useCoreStore, useLaunchStore, type SessionInfo } from '@/05-entities'
import { useAccounts } from '../useAccounts'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
  authRefresh: vi.fn(),
  getSessionInfo: vi.fn(),
}))

const makeSession = (username: string): SessionInfo => ({ uuid: 'u-1', username })

describe('useAccounts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(authLogins).mockReset()
    vi.mocked(authRefresh).mockReset()
    vi.mocked(getSessionInfo).mockReset()
    useCoreStore().currentProject = 'proj'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupAccounts = (): ReturnType<typeof useAccounts> => {
    const { result } = withSetup(() => useAccounts())
    return result
  }

  it('loads the logins and the saved session on mount', async () => {
    vi.mocked(authLogins).mockResolvedValue(['alice', 'bob'])
    vi.mocked(getSessionInfo).mockResolvedValue(makeSession('alice'))

    const accounts = setupAccounts()
    await vi.waitFor(() => expect(accounts.isLoading.value).toBe(false))

    expect(accounts.logins.value).toEqual(['alice', 'bob'])
    const accountsStore = useAccountsStore()
    expect(accountsStore.isLoggedIn).toBe(true)
    expect(accountsStore.session).toEqual(makeSession('alice'))
    expect(accountsStore.selectedUsername).toBe('alice')
  })

  it('stays logged out when there is no saved session', async () => {
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockResolvedValue(null)

    const accounts = setupAccounts()
    await vi.waitFor(() => expect(accounts.isLoading.value).toBe(false))

    expect(useAccountsStore().isLoggedIn).toBe(false)
    expect(accounts.selectedUsername.value).toBe('')
  })

  it('reports the logins load failure', async () => {
    vi.mocked(authLogins).mockRejectedValue(new Error('ipc down'))
    vi.mocked(getSessionInfo).mockResolvedValue(null)

    const accounts = setupAccounts()
    await vi.waitFor(() => expect(useAccountsStore().loginsError).toBe('ipc down'))

    expect(accounts.logins.value).toEqual([])
  })

  it('keeps the silent failure for the session check', async () => {
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockRejectedValue(new Error('ipc down'))

    const accounts = setupAccounts()
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())

    expect(useAccountsStore().isLoggedIn).toBe(false)
    void accounts
  })

  it('switches the account and hydrates the session', async () => {
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'
    vi.mocked(authRefresh).mockResolvedValue(undefined)
    vi.mocked(getSessionInfo).mockResolvedValue(makeSession('bob'))

    await accounts.handleSelect('bob')

    expect(authRefresh).toHaveBeenCalledWith('proj', 'bob')
    const accountsStore = useAccountsStore()
    expect(accountsStore.session).toEqual(makeSession('bob'))
    expect(accountsStore.isLoggedIn).toBe(true)
    expect(accounts.selectedUsername.value).toBe('bob')
    expect(accounts.isLoading.value).toBe(false)
  })

  it('clears the previous launch error when the account changes', async () => {
    const launch = useLaunchStore()
    launch.loginError = 'Не удалось запустить игру'
    const accounts = setupAccounts()
    vi.mocked(authRefresh).mockResolvedValue(undefined)
    vi.mocked(getSessionInfo).mockResolvedValue(makeSession('bob'))

    await accounts.handleSelect('bob')

    expect(launch.loginError).toBe('')
  })

  it('reverts the selection and keeps the previous session on failure', async () => {
    const accountsStore = useAccountsStore()
    accountsStore.isLoggedIn = true
    accountsStore.session = makeSession('alice')
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'
    vi.mocked(authRefresh).mockRejectedValue(new Error('bad token'))

    await accounts.handleSelect('bob')

    expect(accounts.selectedUsername.value).toBe('alice')
    expect(accounts.errorMessage.value).toBe('bad token')
    expect(accountsStore.isLoggedIn).toBe(true)
    expect(accountsStore.session).toEqual(makeSession('alice'))
  })

  it('stays logged out when a select fails without a previous session', async () => {
    const accounts = setupAccounts()
    vi.mocked(authRefresh).mockRejectedValue(new Error('no credentials'))

    await accounts.handleSelect('bob')

    expect(accounts.selectedUsername.value).toBe('')
    expect(accounts.errorMessage.value).toBe('no credentials')
    expect(useAccountsStore().isLoggedIn).toBe(false)
  })

  it('opens the password form when the account has no saved credentials', async () => {
    const accountsStore = useAccountsStore()
    const accounts = setupAccounts()
    vi.mocked(authRefresh).mockRejectedValue({
      code: 'auth_no_saved_credentials',
      message: 'Нет сохранённых учётных данных для "bob", войдите с паролем',
    })

    await accounts.handleSelect('bob')

    expect(accountsStore.showAuthForm).toBe(true)
    expect(accountsStore.activeSubTab).toBe(AUTH_LOGIN_TAB)
    expect(accountsStore.loginFormData.username).toBe('bob')
    expect(accountsStore.authError).toBe('Нет сохранённых учётных данных для "bob", войдите с паролем')
    expect(accounts.selectedUsername.value).toBe('')
  })

  it('keeps the account list error for other select failures', async () => {
    const accountsStore = useAccountsStore()
    const accounts = setupAccounts()
    vi.mocked(authRefresh).mockRejectedValue({ code: 'auth_server', message: 'Сервер недоступен' })

    await accounts.handleSelect('bob')

    expect(accountsStore.showAuthForm).toBe(false)
    expect(accountsStore.authError).toBe('')
    expect(accounts.errorMessage.value).toBe('Сервер недоступен')
  })

  it('ignores a select while another select is running', async () => {
    let releaseRefresh: () => void = () => {}
    vi.mocked(authRefresh).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRefresh = resolve
        }),
    )
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'

    const first = accounts.handleSelect('bob')
    const second = await accounts.handleSelect('carol')

    expect(second).toBeUndefined()
    expect(authRefresh).toHaveBeenCalledTimes(1)
    expect(authRefresh).toHaveBeenCalledWith('proj', 'bob')
    expect(accounts.isLoading.value).toBe(true)

    releaseRefresh()
    await first

    expect(accounts.selectedUsername.value).toBe('bob')
    expect(accounts.isLoading.value).toBe(false)
    expect(accounts.errorMessage.value).toBe('')
  })

  it('does not apply a session checked for a project that changed during the check', async () => {
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockImplementation(async () => {
      useCoreStore().currentProject = 'other'
      return makeSession('alice')
    })

    setupAccounts()
    await vi.waitFor(() => expect(getSessionInfo).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const accountsStore = useAccountsStore()
    expect(accountsStore.isLoggedIn).toBe(false)
    expect(accountsStore.session).toBeNull()
    expect(accountsStore.selectedUsername).toBe('')
  })

  it('leaves no stale selection or session when the project changed during a select', async () => {
    const accountsStore = useAccountsStore()
    accountsStore.isLoggedIn = true
    accountsStore.session = makeSession('alice')
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'
    vi.mocked(authRefresh).mockImplementation(async () => {
      useCoreStore().currentProject = 'other'
      accountsStore.clearSessionState()
      accountsStore.reset()
    })

    await accounts.handleSelect('bob')

    expect(accountsStore.isLoggedIn).toBe(false)
    expect(accountsStore.session).toBeNull()
    expect(accountsStore.selectedUsername).toBe('')
    expect(accounts.isLoading.value).toBe(false)
    expect(accounts.errorMessage.value).toBe('')
  })

  it('does not surface a select error for a project that changed during the select', async () => {
    const accounts = setupAccounts()
    vi.mocked(authRefresh).mockResolvedValue(undefined)
    vi.mocked(getSessionInfo).mockImplementation(async () => {
      useCoreStore().currentProject = 'other'
      throw new Error('ipc down')
    })

    await accounts.handleSelect('bob')

    expect(accounts.errorMessage.value).toBe('')
    expect(accounts.selectedUsername.value).toBe('bob')
  })
})
