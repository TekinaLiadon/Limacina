import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCoreStore, type ProjectConfig, type ServerStatus } from '@/05-entities'

const api = vi.hoisted(() => ({
  getServerStatus: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getServerStatus: api.getServerStatus,
}))

const makeConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: 'https://example.com',
  autoJoinServer: false,
  legacy: false,
  legacyProfile: null,
})

const OK_INTERVAL_MS = 60_000

describe('useServerStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    api.getServerStatus.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const startSync = async (): Promise<void> => {
    const { useServerStatus } = await import('./useServerStatus')
    useServerStatus().startServerStatusSync()
  }

  const watchProject = async (online: boolean): Promise<void> => {
    useCoreStore().projectConfig = makeConfig(online)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('polls the status for an online project', async () => {
    api.getServerStatus.mockResolvedValue({ online: 3, max: 20, version: '1.20.1' })
    await startSync()
    await watchProject(true)

    expect(api.getServerStatus).toHaveBeenCalledTimes(1)
    expect(useCoreStore().serverStatus).toEqual({ online: 3, max: 20, version: '1.20.1' })

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS)
    expect(api.getServerStatus).toHaveBeenCalledTimes(2)
  })

  it('stays idle for an offline project', async () => {
    await startSync()
    await watchProject(false)

    expect(api.getServerStatus).not.toHaveBeenCalled()
    expect(useCoreStore().serverStatus).toBeNull()
  })

  it('keeps the previous status on an isolated failure', async () => {
    const status: ServerStatus = { online: 1, max: 20, version: '1.20.1' }
    api.getServerStatus.mockResolvedValueOnce(status)
    api.getServerStatus.mockRejectedValueOnce(new Error('timeout'))
    await startSync()
    await watchProject(true)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)

    expect(api.getServerStatus).toHaveBeenCalledTimes(2)
    expect(useCoreStore().serverStatus).toEqual(status)
  })

  it('clears the status after three consecutive failures', async () => {
    api.getServerStatus.mockResolvedValueOnce({ online: 5, max: 20, version: '1.20.1' })
    api.getServerStatus.mockRejectedValue(new Error('down'))
    await startSync()
    await watchProject(true)
    expect(useCoreStore().serverStatus).not.toBeNull()

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS)
    expect(useCoreStore().serverStatus).not.toBeNull()

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)
    expect(useCoreStore().serverStatus).not.toBeNull()

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 4)

    expect(api.getServerStatus).toHaveBeenCalledTimes(4)
    expect(useCoreStore().serverStatus).toBeNull()
  })

  it('backs off exponentially up to the cap', async () => {
    api.getServerStatus.mockRejectedValue(new Error('down'))
    await startSync()
    await watchProject(true)
    expect(api.getServerStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2 - 1)
    expect(api.getServerStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getServerStatus).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 4 - 1)
    expect(api.getServerStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getServerStatus).toHaveBeenCalledTimes(3)
  })

  it('stops polling when the project goes offline', async () => {
    api.getServerStatus.mockResolvedValue({ online: 3, max: 20, version: '1.20.1' })
    await startSync()
    await watchProject(true)
    expect(api.getServerStatus).toHaveBeenCalledTimes(1)

    await watchProject(false)
    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 20)

    expect(api.getServerStatus).toHaveBeenCalledTimes(1)
    expect(useCoreStore().serverStatus).toBeNull()
  })
})
