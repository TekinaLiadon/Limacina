import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore } from '@/05-entities'

const api = vi.hoisted(() => ({
  getGameState: vi.fn(),
  hideMainWindow: vi.fn(),
  listenGameExit: vi.fn(),
  listenGameStarted: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getGameState: api.getGameState,
  hideMainWindow: api.hideMainWindow,
  listenGameExit: api.listenGameExit,
  listenGameStarted: api.listenGameStarted,
}))

interface GameSessionApi {
  startGameSessionSync: () => Promise<void>
  minimizeToTray: () => Promise<void>
}

describe('useGameSession', () => {
  let emitStarted: ((username: string) => void) | undefined
  let emitExit: (() => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    emitStarted = undefined
    emitExit = undefined
    api.getGameState.mockReset()
    api.hideMainWindow.mockReset()
    api.listenGameExit.mockReset()
    api.listenGameStarted.mockReset()
    api.listenGameStarted.mockImplementation(async (handler: (username: string) => void) => {
      emitStarted = handler
      return () => {}
    })
    api.listenGameExit.mockImplementation(async (handler: () => void) => {
      emitExit = handler
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const loadSession = async (): Promise<GameSessionApi> => {
    const { useGameSession } = await import('./useGameSession')
    return useGameSession()
  }

  it('hydrates the username from the game state command', async () => {
    api.getGameState.mockResolvedValue('alice')
    const session = await loadSession()

    await session.startGameSessionSync()

    expect(useCoreStore().gameUsername).toBe('alice')
  })

  it('keeps the started event over a slow hydration', async () => {
    let resolveState: (username: string | null) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveState = resolve
        }),
    )
    const session = await loadSession()
    const pending = session.startGameSessionSync()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(1))

    emitStarted?.('alice')
    resolveState('bob')
    await pending

    expect(useCoreStore().gameUsername).toBe('alice')
  })

  it('keeps the exit event over a slow hydration', async () => {
    useCoreStore().gameUsername = 'alice'
    let resolveState: (username: string | null) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveState = resolve
        }),
    )
    const session = await loadSession()
    const pending = session.startGameSessionSync()
    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(1))

    emitExit?.()
    resolveState('alice')
    await pending

    expect(useCoreStore().gameUsername).toBeNull()
  })

  it('clears the username on the exit event after hydration', async () => {
    api.getGameState.mockResolvedValue('alice')
    const session = await loadSession()
    await session.startGameSessionSync()

    emitExit?.()

    expect(useCoreStore().gameUsername).toBeNull()
  })

  it('reports a hydration failure without touching the state', async () => {
    api.getGameState.mockRejectedValue(new Error('ipc down'))
    const session = await loadSession()

    await session.startGameSessionSync()

    expect(useCoreStore().gameUsername).toBeNull()
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
    api.getGameState.mockResolvedValue(null)
    const session = await loadSession()

    await session.startGameSessionSync()
    await session.startGameSessionSync()

    expect(api.getGameState).toHaveBeenCalledTimes(1)
    expect(api.listenGameStarted).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight sync across callers', async () => {
    let resolveState: (username: string | null) => void = () => {}
    api.getGameState.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveState = resolve
        }),
    )
    const session = await loadSession()

    const first = session.startGameSessionSync()
    const second = session.startGameSessionSync()
    expect(first).toBe(second)

    await vi.waitFor(() => expect(api.getGameState).toHaveBeenCalledTimes(1))
    resolveState('alice')
    await Promise.all([first, second])

    expect(useCoreStore().gameUsername).toBe('alice')
    expect(api.getGameState).toHaveBeenCalledTimes(1)
  })

  it('minimizes the window to tray', async () => {
    const session = await loadSession()

    await session.minimizeToTray()

    expect(api.hideMainWindow).toHaveBeenCalledTimes(1)
  })

  it('survives a failed hide when minimizing to tray', async () => {
    api.hideMainWindow.mockRejectedValue(new Error('tray gone'))
    const session = await loadSession()

    await expect(session.minimizeToTray()).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith(
      'Не удалось свернуть окно в трей',
      expect.any(Error),
    )
  })
})
