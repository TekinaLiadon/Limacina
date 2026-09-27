import { useCoreStore } from '@/05-entities'
import { getGameState, hideMainWindow, listenGameExit, listenGameStarted } from '@/06-shared/api'
import { reportError } from '@/06-shared'

let sessionSyncStarted = false
let unlistenStarted: (() => void) | null = null
let unlistenExit: (() => void) | null = null

export function useGameSession(): {
  startGameSessionSync: () => Promise<void>
  minimizeToTray: () => Promise<void>
} {
  const coreStore = useCoreStore()

  const startGameSessionSync = async (): Promise<void> => {
    if (sessionSyncStarted) return
    sessionSyncStarted = true

    let eventBeforeHydrate = false

    try {
      unlistenStarted = await listenGameStarted((username: string): void => {
        eventBeforeHydrate = true
        coreStore.gameUsername = username
      })
      unlistenExit = await listenGameExit((): void => {
        eventBeforeHydrate = true
        coreStore.gameUsername = null
      })
    } catch (e: unknown) {
      unlistenStarted?.()
      unlistenExit?.()
      unlistenStarted = null
      unlistenExit = null
      sessionSyncStarted = false
      reportError('Не удалось запустить синхронизацию игровой сессии', e)
      return
    }

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
