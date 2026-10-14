import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLaunchStore, useNotificationStore } from '@/05-entities'
import { getGameState, killGameProcess, listenGameExit, listenGameStarted } from '@/06-shared/api'
import { useKillGame } from '../useKillGame'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  killGameProcess: vi.fn(),
  getGameState: vi.fn(),
  listenGameStarted: vi.fn(),
  listenGameExit: vi.fn(),
}))

describe('useKillGame', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(killGameProcess).mockReset()
    vi.mocked(getGameState).mockReset()
    vi.mocked(getGameState).mockResolvedValue([])
    vi.mocked(listenGameStarted).mockResolvedValue(() => {})
    vi.mocked(listenGameExit).mockResolvedValue(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('kills the running game without a toast', async () => {
    useLaunchStore().gameUsernames = ['alice']
    vi.mocked(killGameProcess).mockResolvedValue(undefined)
    const { killGame, isKilling, isGameRunning } = useKillGame()

    expect(isGameRunning.value).toBe(true)

    await killGame()

    expect(killGameProcess).toHaveBeenCalledTimes(1)
    expect(isKilling.value).toBe(false)
    expect(useNotificationStore().visible).toBe(false)
  })

  it('clears the running session after a kill without a game-exit event', async () => {
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice', 'bob']
    vi.mocked(killGameProcess).mockResolvedValue(undefined)
    const { killGame, isGameRunning } = useKillGame()

    await killGame()

    expect(launch.gameUsernames).toEqual([])
    expect(isGameRunning.value).toBe(false)
    expect(getGameState).not.toHaveBeenCalled()
  })

  it('reconciles the ghost session with the backend when the kill fails', async () => {
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice']
    vi.mocked(killGameProcess).mockRejectedValue(new Error('Игра не запущена'))
    vi.mocked(getGameState).mockResolvedValue([])
    const { killGame, isGameRunning } = useKillGame()

    await killGame()

    expect(launch.gameUsernames).toEqual([])
    expect(isGameRunning.value).toBe(false)
    const notificationStore = useNotificationStore()
    expect(notificationStore.visible).toBe(true)
    expect(notificationStore.message).toContain('Не удалось завершить процесс игры')
  })

  it('keeps the session when the backend still reports it after a failed kill', async () => {
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice']
    vi.mocked(killGameProcess).mockRejectedValue(new Error('отказано в доступе'))
    vi.mocked(getGameState).mockResolvedValue(['alice'])
    const { killGame, isGameRunning } = useKillGame()

    await killGame()

    expect(launch.gameUsernames).toEqual(['alice'])
    expect(isGameRunning.value).toBe(true)
    expect(useNotificationStore().message).toContain('отказано в доступе')
  })

  it('tracks the running state from the session username', () => {
    const { isGameRunning } = useKillGame()

    expect(isGameRunning.value).toBe(false)

    useLaunchStore().gameUsernames = ['bob']

    expect(isGameRunning.value).toBe(true)
  })

  it('shows a message and skips ipc when the game is not running', async () => {
    const { killGame } = useKillGame()

    await killGame()

    expect(killGameProcess).not.toHaveBeenCalled()
    const notificationStore = useNotificationStore()
    expect(notificationStore.visible).toBe(true)
    expect(notificationStore.message).toContain('Игра не запущена')
  })

  it('ignores a repeated click while a kill is in flight', async () => {
    useLaunchStore().gameUsernames = ['alice']
    let resolveKill: () => void = () => {}
    vi.mocked(killGameProcess).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveKill = resolve
        }),
    )
    const { killGame, isKilling } = useKillGame()

    const first = killGame()
    const second = killGame()
    expect(isKilling.value).toBe(true)
    resolveKill()
    await Promise.all([first, second])

    expect(killGameProcess).toHaveBeenCalledTimes(1)
  })
})
