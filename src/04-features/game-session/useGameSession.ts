import { useCoreStore } from '@/05-entities'
import { getGameState, hideMainWindow, listenGameExit, listenGameStarted } from '@/06-shared/api'
import { reportError } from '@/06-shared'

let sessionSyncStarted = false

export function useGameSession(): {
  startGameSessionSync: () => Promise<void>
  minimizeToTray: () => Promise<void>
} {
  const coreStore = useCoreStore()

  const startGameSessionSync = async (): Promise<void> => {
    if (sessionSyncStarted) return
    sessionSyncStarted = true

    let eventBeforeHydrate = false

    await listenGameStarted((username: string): void => {
      eventBeforeHydrate = true
      coreStore.gameUsername = username
    })
    await listenGameExit((): void => {
      eventBeforeHydrate = true
      coreStore.gameUsername = null
    })

    try {
      const username = await getGameState()
      if (!eventBeforeHydrate) coreStore.gameUsername = username
    } catch (e: unknown) {
      reportError('Не удалось получить состояние игровой сессии', e)
    }
  }

  const minimizeToTray = async (): Promise<void> => {
    await hideMainWindow()
  }

  return {
    startGameSessionSync,
    minimizeToTray,
  }
}
