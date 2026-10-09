import { useCoreStore } from '@/05-entities'
import { pingLauncherServer } from '@/06-shared/api'
import type { BackoffPoller } from '@/06-shared'
import { createServerPoller } from '../server-polling/createServerPoller'

const OK_INTERVAL_MS = 30_000

let poller: BackoffPoller | null = null

export function useServerAvailability(): {
  startServerAvailabilitySync: () => void
} {
  const coreStore = useCoreStore()

  if (poller === null) {
    poller = createServerPoller<boolean>({
      okIntervalMs: OK_INTERVAL_MS,
      fetch: async (): Promise<boolean> => {
        const reachable = await pingLauncherServer()
        if (!reachable) throw new Error('Лаунчер-сервер недоступен')
        return reachable
      },
      applySuccess: (reachable: boolean): void => {
        coreStore.isServerReachable = reachable
      },
      onFailureStreak: (): void => {
        coreStore.isServerReachable = false
      },
      applyIdle: (): void => {
        coreStore.isServerReachable = null
      },
    })
  }

  return {
    startServerAvailabilitySync: poller.startSync,
  }
}
