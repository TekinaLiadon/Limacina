import { useCoreStore } from '@/05-entities'
import { pingLauncherServer } from '@/06-shared/api'
import { createBackoffPoller, type BackoffPoller } from '@/06-shared'

const OK_INTERVAL_MS = 30_000
const MAX_INTERVAL_MS = 300_000

let poller: BackoffPoller | null = null

export function useServerAvailability(): {
  startServerAvailabilitySync: () => void
} {
  const coreStore = useCoreStore()

  if (poller === null) {
    const isWatched = (): boolean =>
      !coreStore.offlineBuild && coreStore.projectConfig?.online === true

    poller = createBackoffPoller<boolean>({
      okIntervalMs: OK_INTERVAL_MS,
      maxIntervalMs: MAX_INTERVAL_MS,
      watchSource: () => coreStore.projectConfig,
      isWatched,
      shouldPoll: isWatched,
      fetch: async (): Promise<boolean> => {
        const reachable = await pingLauncherServer()
        if (!reachable) throw new Error('Лаунчер-сервер недоступен')
        return reachable
      },
      applySuccess: (reachable: boolean): void => {
        coreStore.isServerReachable = reachable
      },
      applyError: (): void => {
        coreStore.isServerReachable = false
      },
      applyIdle: (): void => {
        coreStore.isServerReachable = null
      },
    })
  }

  const engine: BackoffPoller = poller

  return {
    startServerAvailabilitySync: engine.startSync,
  }
}
