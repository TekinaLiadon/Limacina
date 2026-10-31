import { useLaunchStore, type GameExitInfo } from '@/05-entities'
import { getGameState, listenGameExit, listenGameStarted } from '@/06-shared/api'
import { createSingletonListeners, reportError } from '@/06-shared'

let syncGameSessionPromise: Promise<void> | null = null
let latestHydrationId = 0
let sessionEventCount = 0
const gameSessionListeners = createSingletonListeners()

const hydrateSessionState = async (): Promise<void> => {
  const launchStore = useLaunchStore()
  const hydrationId = ++latestHydrationId
  const eventsAtHydrationStart = sessionEventCount
  try {
    const usernames = await getGameState()
    if (hydrationId !== latestHydrationId || eventsAtHydrationStart !== sessionEventCount) return
    launchStore.setGameSessions(usernames)
  } catch (e: unknown) {
    reportError('Не удалось получить состояние игровой сессии', e)
  }
}

const runSessionSync = async (): Promise<void> => {
  try {
    await gameSessionListeners.start(async (track): Promise<void> => {
      track(await listenGameStarted((username: string): void => {
        sessionEventCount += 1
        useLaunchStore().addGameSession(username)
      }))
      track(await listenGameExit((info: GameExitInfo): void => {
        sessionEventCount += 1
        useLaunchStore().removeGameSession(info.username)
      }))
    })
  } catch (e: unknown) {
    syncGameSessionPromise = null
    reportError('Не удалось запустить синхронизацию игровой сессии', e)
    return
  }

  await hydrateSessionState()
}

export const syncGameSession = (): Promise<void> => {
  if (syncGameSessionPromise === null) syncGameSessionPromise = runSessionSync()
  return syncGameSessionPromise
}

export const resyncGameSession = async (): Promise<void> => {
  await syncGameSession()
  await hydrateSessionState()
}

export function useGameSession(): {
  startGameSessionSync: () => Promise<void>
  resyncGameSession: () => Promise<void>
} {
  return {
    startGameSessionSync: syncGameSession,
    resyncGameSession,
  }
}
