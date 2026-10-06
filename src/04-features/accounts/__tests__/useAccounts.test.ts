import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authLogins, authRefresh, getSessionInfo } from '@/06-shared/api'
import { useAccountsStore, useCoreStore, type SessionInfo } from '@/05-entities'
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
    const core = useCoreStore()
    expect(core.isLoggedIn).toBe(true)
    expect(core.session).toEqual(makeSession('alice'))
    expect(useAccountsStore().selectedUsername).toBe('alice')
  })

  it('stays logged out when there is no saved session', async () => {
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockResolvedValue(null)

    const accounts = setupAccounts()
    await vi.waitFor(() => expect(accounts.isLoading.value).toBe(false))

    expect(useCoreStore().isLoggedIn).toBe(false)
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

    expect(useCoreStore().isLoggedIn).toBe(false)
    void accounts
  })

  it('switches the account and hydrates the session', async () => {
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'
    vi.mocked(authRefresh).mockResolvedValue(undefined)
    vi.mocked(getSessionInfo).mockResolvedValue(makeSession('bob'))

    await accounts.handleSelect('bob')

    expect(authRefresh).toHaveBeenCalledWith('proj', 'bob')
    const core = useCoreStore()
    expect(core.session).toEqual(makeSession('bob'))
    expect(core.isLoggedIn).toBe(true)
    expect(accounts.selectedUsername.value).toBe('bob')
    expect(accounts.isLoading.value).toBe(false)
  })

  it('reverts the selection and keeps the previous session on failure', async () => {
    const core = useCoreStore()
    core.isLoggedIn = true
    core.session = makeSession('alice')
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'
    vi.mocked(authRefresh).mockRejectedValue(new Error('bad token'))

    await accounts.handleSelect('bob')

    expect(accounts.selectedUsername.value).toBe('alice')
    expect(accounts.errorMessage.value).toBe('bad token')
    expect(core.isLoggedIn).toBe(true)
    expect(core.session).toEqual(makeSession('alice'))
  })

  it('stays logged out when a select fails without a previous session', async () => {
    const accounts = setupAccounts()
    vi.mocked(authRefresh).mockRejectedValue(new Error('no credentials'))

    await accounts.handleSelect('bob')

    expect(accounts.selectedUsername.value).toBe('')
    expect(accounts.errorMessage.value).toBe('no credentials')
    expect(useCoreStore().isLoggedIn).toBe(false)
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

    const core = useCoreStore()
    expect(core.isLoggedIn).toBe(false)
    expect(core.session).toBeNull()
    expect(useAccountsStore().selectedUsername).toBe('')
  })

  it('leaves no stale selection or session when the project changed during a select', async () => {
    const core = useCoreStore()
    core.isLoggedIn = true
    core.session = makeSession('alice')
    const accounts = setupAccounts()
    accounts.selectedUsername.value = 'alice'
    vi.mocked(authRefresh).mockImplementation(async () => {
      const switched = useCoreStore()
      switched.currentProject = 'other'
      switched.clearSessionState()
      useAccountsStore().reset()
    })

    await accounts.handleSelect('bob')

    expect(core.isLoggedIn).toBe(false)
    expect(core.session).toBeNull()
    expect(useAccountsStore().selectedUsername).toBe('')
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
