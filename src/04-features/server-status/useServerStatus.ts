import { useCoreStore, type ServerStatus } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'
import { createBackoffPoller, type BackoffPoller } from '@/06-shared'

const OK_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 300_000
export const FAILURE_THRESHOLD = 3

let poller: BackoffPoller | null = null

export function useServerStatus(): {
  startServerStatusSync: () => void
} {
  const coreStore = useCoreStore()

  if (poller === null) {
    poller = createBackoffPoller<ServerStatus>({
      okIntervalMs: OK_INTERVAL_MS,
      maxIntervalMs: MAX_INTERVAL_MS,
      failureThreshold: FAILURE_THRESHOLD,
      watchSource: () => coreStore.projectConfig,
      isWatched: (): boolean => coreStore.isOnlineProject,
      fetch: getServerStatus,
      applySuccess: (status: ServerStatus): void => {
        coreStore.serverStatus = status
      },
      applyIdle: (): void => {
        coreStore.serverStatus = null
      },
      onFailureStreak: (): void => {
        coreStore.serverStatus = null
      },
    })
  }

  return {
    startServerStatusSync: poller.startSync,
  }
}
