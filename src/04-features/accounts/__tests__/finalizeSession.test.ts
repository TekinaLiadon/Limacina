import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { clearSession } from '@/06-shared/api'
import { useAccountsStore } from '@/05-entities'
import { finalizeSession } from '../finalizeSession'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  clearSession: vi.fn(),
}))

describe('finalizeSession', () => {
  it('clears the backend session and the local session state', async () => {
    setActivePinia(createPinia())
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const store = useAccountsStore()
    store.isLoggedIn = true
    store.session = { uuid: 'u-1', username: 'alice' }

    await finalizeSession()

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(store.isLoggedIn).toBe(false)
    expect(store.session).toBeNull()
  })

  it('clears the local session state even when the backend call fails', async () => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(clearSession).mockRejectedValue(new Error('ipc down'))
    const store = useAccountsStore()
    store.isLoggedIn = true
    store.session = { uuid: 'u-1', username: 'alice' }

    await expect(finalizeSession()).resolves.toBeUndefined()

    expect(store.isLoggedIn).toBe(false)
    expect(store.session).toBeNull()

    vi.restoreAllMocks()
  })
})
