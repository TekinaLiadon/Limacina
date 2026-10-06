import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authLogins } from '@/06-shared/api'
import { useAccountsList } from '../useAccountsList'
import { useAccountsStore, useCoreStore } from '@/05-entities'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
}))

describe('useAccountsList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing without a current project', async () => {
    const store = useAccountsStore()
    await useAccountsList().loadAccounts()
    expect(authLogins).not.toHaveBeenCalled()
    expect(store.isLoginsLoading).toBe(false)
    expect(store.logins).toEqual([])
  })

  it('loads logins for the current project', async () => {
    vi.mocked(authLogins).mockResolvedValue(['alice', 'bob'])
    useCoreStore().currentProject = 'proj'
    const store = useAccountsStore()
    await useAccountsList().loadAccounts()
    expect(authLogins).toHaveBeenCalledWith('proj')
    expect(store.logins).toEqual(['alice', 'bob'])
    expect(store.loginsError).toBe('')
    expect(store.isLoginsLoading).toBe(false)
  })

  it('stores the error message when the ipc call fails', async () => {
    vi.mocked(authLogins).mockRejectedValue(new Error('ipc down'))
    useCoreStore().currentProject = 'proj'
    const store = useAccountsStore()
    await useAccountsList().loadAccounts()
    expect(store.loginsError).toBe('ipc down')
    expect(store.logins).toEqual([])
    expect(store.isLoginsLoading).toBe(false)
  })

  it('keeps the loading flag owned by the newer load after a project switch', async () => {
    let resolveAuth: (value: string[]) => void = () => {}
    vi.mocked(authLogins).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveAuth = resolve
        }),
    )
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj-a'
    const store = useAccountsStore()
    const promise = useAccountsList().loadAccounts()

    coreStore.currentProject = 'proj-b'
    resolveAuth(['stale'])
    await promise

    expect(store.logins).toEqual([])
    expect(store.loginsError).toBe('')
    expect(store.isLoginsLoading).toBe(true)
  })
})
