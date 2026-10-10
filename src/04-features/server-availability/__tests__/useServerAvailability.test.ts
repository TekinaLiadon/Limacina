import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCoreStore, useServerStore, type ProjectConfig } from '@/05-entities'
import { SERVER_POLL_FAILURE_THRESHOLD as FAILURE_THRESHOLD } from '../../server-polling/createServerPoller'

const api = vi.hoisted(() => ({
  pingLauncherServer: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  pingLauncherServer: api.pingLauncherServer,
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
})

const OK_INTERVAL_MS = 30_000

const advanceAfterFailures = async (count: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2 ** count)
}

describe('useServerAvailability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    api.pingLauncherServer.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const startSync = async (): Promise<void> => {
    const { useServerAvailability } = await import('../useServerAvailability')
    useServerAvailability().startServerAvailabilitySync()
  }

  const watchProject = async (online: boolean): Promise<void> => {
    useCoreStore().projectConfig = makeConfig(online)
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
  }

  it('reports a reachable server for an online project', async () => {
    api.pingLauncherServer.mockResolvedValue(true)
    await startSync()
    await watchProject(true)

    expect(api.pingLauncherServer).toHaveBeenCalledTimes(1)
    expect(useServerStore().isServerReachable).toBe(true)
  })

  it('keeps the flag unknown after a single failed ping', async () => {
    api.pingLauncherServer.mockResolvedValue(false)
    await startSync()
    await watchProject(true)

    expect(useServerStore().isServerReachable).toBeNull()
  })

  it('keeps the flag unknown when the ping rejects', async () => {
    api.pingLauncherServer.mockRejectedValue(new Error('probe failed'))
    await startSync()
    await watchProject(true)

    expect(useServerStore().isServerReachable).toBeNull()
  })

  it('keeps the reachable flag on an isolated failure', async () => {
    api.pingLauncherServer.mockResolvedValueOnce(true)
    api.pingLauncherServer.mockResolvedValue(false)
    await startSync()
    await watchProject(true)
    expect(useServerStore().isServerReachable).toBe(true)

    await advanceAfterFailures(1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(2)
    expect(useServerStore().isServerReachable).toBe(true)
  })

  it('marks the server unreachable after a failure streak of the threshold length', async () => {
    api.pingLauncherServer.mockResolvedValue(false)
    await startSync()
    await watchProject(true)

    for (let failures = 1; failures < FAILURE_THRESHOLD - 1; failures++) {
      await advanceAfterFailures(failures)
      expect(api.pingLauncherServer).toHaveBeenCalledTimes(failures + 1)
      expect(useServerStore().isServerReachable).toBeNull()
    }

    await advanceAfterFailures(FAILURE_THRESHOLD - 1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(FAILURE_THRESHOLD)
    expect(useServerStore().isServerReachable).toBe(false)
  })

  it('recovers instantly after a failure streak', async () => {
    api.pingLauncherServer.mockResolvedValue(false)
    await startSync()
    await watchProject(true)

    for (let failures = 1; failures < FAILURE_THRESHOLD; failures++) {
      await advanceAfterFailures(failures)
    }
    expect(useServerStore().isServerReachable).toBe(false)

    api.pingLauncherServer.mockResolvedValue(true)
    await advanceAfterFailures(FAILURE_THRESHOLD)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(FAILURE_THRESHOLD + 1)
    expect(useServerStore().isServerReachable).toBe(true)
  })

  it('resets the failure streak after an intermittent success', async () => {
    api.pingLauncherServer.mockResolvedValueOnce(false)
    api.pingLauncherServer.mockResolvedValueOnce(false)
    api.pingLauncherServer.mockResolvedValueOnce(true)
    api.pingLauncherServer.mockResolvedValue(false)
    await startSync()
    await watchProject(true)

    await advanceAfterFailures(1)
    await advanceAfterFailures(2)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(3)
    expect(useServerStore().isServerReachable).toBe(true)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(4)
    expect(useServerStore().isServerReachable).toBe(true)
  })

  it('doubles the polling interval after consecutive failures', async () => {
    api.pingLauncherServer.mockResolvedValue(false)
    await startSync()
    await watchProject(true)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2 - 1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 4 - 1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(3)
  })

  it('restores the base interval after a recovery', async () => {
    api.pingLauncherServer.mockResolvedValueOnce(false)
    api.pingLauncherServer.mockResolvedValue(true)
    await startSync()
    await watchProject(true)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(2)
    expect(useServerStore().isServerReachable).toBe(true)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS - 1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(3)
  })

  it('stays idle for an offline project', async () => {
    await startSync()
    await watchProject(false)

    expect(api.pingLauncherServer).not.toHaveBeenCalled()
    expect(useServerStore().isServerReachable).toBeNull()
  })

  it('stays idle for an offline build', async () => {
    useCoreStore().offlineBuild = true
    await startSync()
    await watchProject(true)

    expect(api.pingLauncherServer).not.toHaveBeenCalled()
    expect(useServerStore().isServerReachable).toBeNull()
  })

  it('resets to idle and stops polling when the project goes offline', async () => {
    api.pingLauncherServer.mockResolvedValue(true)
    await startSync()
    await watchProject(true)
    expect(useServerStore().isServerReachable).toBe(true)

    await watchProject(false)

    expect(useServerStore().isServerReachable).toBeNull()
    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 20)
    expect(api.pingLauncherServer).toHaveBeenCalledTimes(1)
  })
})
