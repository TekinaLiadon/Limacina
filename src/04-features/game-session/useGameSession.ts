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

    try {
      coreStore.gameUsername = await getGameState()
    } catch (e: unknown) {
      reportError('Не удалось получить состояние игровой сессии', e)
    }

    await listenGameStarted((username: string): void => {
      coreStore.gameUsername = username
    })
    await listenGameExit((): void => {
      coreStore.gameUsername = null
    })
  }

  const minimizeToTray = async (): Promise<void> => {
    await hideMainWindow()
  }

  return {
    startGameSessionSync,
    minimizeToTray,
  }
}
