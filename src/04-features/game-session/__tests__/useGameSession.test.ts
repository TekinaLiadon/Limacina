import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLaunchStore, type GameExitInfo } from '@/05-entities'

const api = vi.hoisted(() => ({
  getGameState: vi.fn(),
  listenGameExit: vi.fn(),
  listenGameStarted: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getGameState: api.getGameState,
  listenGameExit: api.listenGameExit,
  listenGameStarted: api.listenGameStarted,
}))

interface GameSessionApi {
  startGameSessionSync: () => Promise<void>
  resyncGameSession: () => Promise<void>
}

describe('useGameSession', () => {
  let emitStarted: ((username: string) => void) | undefined
  let emitExit: ((info: GameExitInfo) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    emitStarted = undefined
    emitExit = undefined
    api.getGameState.mockReset()
    api.listenGameExit.mockReset()
    api.listenGameStarted.mockReset()
    api.listenGameStarted.mockImplementation(async (handler: (username: string) => void) => {
      emitStarted = handler
      return () => {}
    })
    api.listenGameExit.mockImplementation(async (handler: (info: GameExitInfo) => void) => {
      emitExit = handler
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const loadSession = async (): Promise<GameSessionApi> => {
    const { useGameSession } = await import('../useGameSession')
    return useGameSession()
  }

  const exitInfo = (username: string): GameExitInfo => ({
    success: true,
    code: 0,
    reason: null,
    username,
    killedByLauncher: false,
  })

  it('hydrates the running usernames from the game state command', async () => {
    api.getGameState.mockResolvedValue(['alice', 'bob'])
    const session = await loadSession()

    await session.startGameSessionSync()

    expect(useLaunchStore().gameUsernames).toEqual(['alice', 'bob'])
  })

  it('reconciles the hydrated set through the tracked session actions', async () => {
    useLaunchStore().gameUsernames = ['ghost']
    api.getGameState.mockResolvedValue(['alice', 'alice'])
    const session = await loadSession()

    await session.startGameSessionSync()

    expect(useLaunchStore().gameUsernames).toEqual(['alice'])
  })

  it('adds the started session and keeps the running ones', async () => {
    api.getGameState.mockResolvedValue(['alice'])
    const session = await loadSession()
    await session.startGameSessionSync()

    emitStarted?.('bob')

    expect(useLaunchStore().gameUsernames).toEqual(['alice', 'bob'])
  })

  it('does not duplicate a repeated started event for the same account', async () => {
    api.getGameState.mockResolvedValue(['alice'])
    const session = await loadSession()
    await session.startGameSessionSync()

    emitStarted?.('alice')

    expect(useLaunchStore().gameUsernames).toEqual(['alice'])
  })

  it('removes only the exited account from the running set', async () => {
    api.getGameState.mockResolvedValue(['alice', 'bob'])
    const session = await loadSession()
    await session.startGameSessionSync()

    emitExit?.(exitInfo('alice'))

    expect(useLaunchStore().gameUsernames).toEqual(['bob'])

    emitExit?.(exitInfo('bob'))

    expect(useLaunchStore().gameUsernames).toEqual([])
  })

  it('ignores an exit event for an unknown account', async () => {
    api.getGameState.mockResolvedValue(['alice'])
    const session = await loadSession()
    await session.startGameSessionSync()

    emitExit?.(exitInfo('carol'))

    expect(useLaunchStore().gameUsernames).toEqual(['alice'])
  })

  it('keeps the started event over a slow hydration', async () => {
    let resolveState: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveState = resolve
        }),
    )
    const session = await loadSession()
    const pending = session.startGameSessionSync()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(1))

    emitStarted?.('alice')
    resolveState(['bob'])
    await pending

    expect(useLaunchStore().gameUsernames).toEqual(['alice'])
  })

  it('keeps the exit event over a slow hydration', async () => {
    useLaunchStore().gameUsernames = ['alice', 'bob']
    let resolveState: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveState = resolve
        }),
    )
    const session = await loadSession()
    const pending = session.startGameSessionSync()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(1))

    emitExit?.(exitInfo('alice'))
    resolveState(['bob'])
    await pending

    expect(useLaunchStore().gameUsernames).toEqual(['bob'])
  })

  it('applies only the freshest snapshot when two hydrations overlap', async () => {
    api.getGameState.mockResolvedValueOnce(['carol'])
    const session = await loadSession()
    await session.startGameSessionSync()

    let resolveStale: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveStale = resolve
        }),
    )
    const pendingStale = session.resyncGameSession()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(2))

    api.getGameState.mockResolvedValueOnce(['carol', 'alice'])
    await session.resyncGameSession()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(3))

    resolveStale(['carol'])
    await pendingStale

    expect(useLaunchStore().gameUsernames).toEqual(['carol', 'alice'])
  })

  it('keeps the event-applied session over a stale snapshot of an older hydration', async () => {
    api.getGameState.mockResolvedValueOnce(['carol'])
    const session = await loadSession()
    await session.startGameSessionSync()

    let resolveStale: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveStale = resolve
        }),
    )
    const pendingStale = session.resyncGameSession()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(2))

    emitStarted?.('alice')
    expect(useLaunchStore().gameUsernames).toEqual(['carol', 'alice'])

    api.getGameState.mockResolvedValueOnce(['carol', 'alice'])
    await session.resyncGameSession()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(3))

    resolveStale(['carol'])
    await pendingStale

    expect(useLaunchStore().gameUsernames).toEqual(['carol', 'alice'])
  })

  it('keeps the running session when the newer hydration fails', async () => {
    api.getGameState.mockResolvedValueOnce(['carol'])
    const session = await loadSession()
    await session.startGameSessionSync()

    let resolveStale: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveStale = resolve
        }),
    )
    const pendingStale = session.resyncGameSession()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(2))

    emitStarted?.('alice')

    api.getGameState.mockRejectedValueOnce(new Error('ipc down'))
    await session.resyncGameSession()

    resolveStale(['carol'])
    await pendingStale

    expect(useLaunchStore().gameUsernames).toEqual(['carol', 'alice'])
  })

  it('reports a hydration failure without touching the state', async () => {
    api.getGameState.mockRejectedValue(new Error('ipc down'))
    const session = await loadSession()

    await session.startGameSessionSync()

    expect(useLaunchStore().gameUsernames).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      'Не удалось получить состояние игровой сессии',
      expect.any(Error),
    )
  })

  it('cleans up the subscriptions and allows a retry when setup fails', async () => {
    const stopStarted = vi.fn()
    api.listenGameStarted.mockImplementationOnce(async () => stopStarted)
    api.listenGameExit.mockRejectedValueOnce(new Error('no bus'))
    const session = await loadSession()

    await session.startGameSessionSync()
    expect(stopStarted).toHaveBeenCalledTimes(1)

    await session.startGameSessionSync()

    expect(api.listenGameStarted).toHaveBeenCalledTimes(2)
    expect(api.listenGameExit).toHaveBeenCalledTimes(2)
    expect(api.getGameState).toHaveBeenCalledTimes(1)
  })

  it('starts the sync only once', async () => {
    api.getGameState.mockResolvedValue([])
    const session = await loadSession()

    await session.startGameSessionSync()
    await session.startGameSessionSync()

    expect(api.getGameState).toHaveBeenCalledTimes(1)
    expect(api.listenGameStarted).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight sync across callers', async () => {
    let resolveState: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveState = resolve
        }),
    )
    const session = await loadSession()

    const first = session.startGameSessionSync()
    const second = session.startGameSessionSync()
    expect(first).toBe(second)

    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(1))
    resolveState(['alice'])
    await Promise.all([first, second])

    expect(useLaunchStore().gameUsernames).toEqual(['alice'])
    expect(api.getGameState).toHaveBeenCalledTimes(1)
  })

  it('re-syncs the running set on demand after a lost exit event', async () => {
    api.getGameState.mockResolvedValueOnce(['alice'])
    const session = await loadSession()
    await session.startGameSessionSync()

    expect(useLaunchStore().gameUsernames).toEqual(['alice'])

    api.getGameState.mockResolvedValue([])
    await session.resyncGameSession()

    expect(useLaunchStore().gameUsernames).toEqual([])
  })

  it('retries the listener setup on a resync after a failed start', async () => {
    api.listenGameExit.mockRejectedValueOnce(new Error('no bus'))
    const session = await loadSession()

    await session.startGameSessionSync()
    expect(useLaunchStore().gameUsernames).toEqual([])

    api.getGameState.mockResolvedValue(['alice'])
    await session.resyncGameSession()

    expect(api.listenGameStarted).toHaveBeenCalledTimes(2)
    expect(api.listenGameExit).toHaveBeenCalledTimes(2)
    expect(useLaunchStore().gameUsernames).toEqual(['alice'])
  })

  it('keeps an exit event that lands during a resync hydration', async () => {
    api.getGameState.mockResolvedValue(['alice', 'bob'])
    const session = await loadSession()
    await session.startGameSessionSync()

    let resolveState: (usernames: string[]) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveState = resolve
        }),
    )
    const pending = session.resyncGameSession()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(2))

    emitExit?.(exitInfo('alice'))
    resolveState(['alice', 'bob'])
    await pending

    expect(useLaunchStore().gameUsernames).toEqual(['bob'])
  })
})
