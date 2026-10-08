import { useCoreStore } from '@/05-entities'
import { getGameState, hideMainWindow, listenGameExit, listenGameStarted } from '@/06-shared/api'
import { createSingletonListeners, reportError } from '@/06-shared'

let syncGameSessionPromise: Promise<void> | null = null
const gameSessionListeners = createSingletonListeners()

const runSessionSync = async (): Promise<void> => {
  const coreStore = useCoreStore()

  let eventBeforeHydrate = false

  try {
    await gameSessionListeners.start(async (track): Promise<void> => {
      track(await listenGameStarted((username: string): void => {
        eventBeforeHydrate = true
        coreStore.gameUsername = username
      }))
      track(await listenGameExit((): void => {
        eventBeforeHydrate = true
        coreStore.gameUsername = null
      }))
    })
  } catch (e: unknown) {
    syncGameSessionPromise = null
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

export const syncGameSession = (): Promise<void> => {
  if (syncGameSessionPromise === null) syncGameSessionPromise = runSessionSync()
  return syncGameSessionPromise
}

export function useGameSession(): {
  startGameSessionSync: () => Promise<void>
  minimizeToTray: () => Promise<void>
} {
  return {
    startGameSessionSync: syncGameSession,
    minimizeToTray: async (): Promise<void> => {
      try {
        await hideMainWindow()
      } catch (e: unknown) {
        reportError('Не удалось свернуть окно в трей', e)
      }
    },
  }
}
