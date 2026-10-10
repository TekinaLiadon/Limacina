import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLaunchStore, useNotificationStore } from '@/05-entities'
import { killGameProcess } from '@/06-shared/api'
import { useKillGame } from '../useKillGame'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  killGameProcess: vi.fn(),
}))

describe('useKillGame', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(killGameProcess).mockReset()
  })

  it('kills the running game without a toast', async () => {
    useLaunchStore().gameUsername = 'alice'
    vi.mocked(killGameProcess).mockResolvedValue(undefined)
    const { killGame, isKilling, isGameRunning } = useKillGame()

    expect(isGameRunning.value).toBe(true)

    await killGame()

    expect(killGameProcess).toHaveBeenCalledTimes(1)
    expect(isKilling.value).toBe(false)
    expect(useNotificationStore().visible).toBe(false)
  })

  it('tracks the running state from the session username', () => {
    const { isGameRunning } = useKillGame()

    expect(isGameRunning.value).toBe(false)

    useLaunchStore().gameUsername = 'bob'

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

  it('surfaces the kill failure as a toast with the command message', async () => {
    useLaunchStore().gameUsername = 'alice'
    vi.mocked(killGameProcess).mockRejectedValue(new Error('отказано в доступе'))
    const { killGame, isKilling } = useKillGame()

    await killGame()

    const notificationStore = useNotificationStore()
    expect(notificationStore.visible).toBe(true)
    expect(notificationStore.message).toContain('Не удалось завершить процесс игры')
    expect(notificationStore.message).toContain('отказано в доступе')
    expect(isKilling.value).toBe(false)
  })

  it('ignores a repeated click while a kill is in flight', async () => {
    useLaunchStore().gameUsername = 'alice'
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
