import { useCoreStore } from '@/05-entities'
import { createBackoffPoller, type BackoffPoller } from '@/06-shared'

export const SERVER_POLL_FAILURE_THRESHOLD = 3
const MAX_INTERVAL_MS = 300_000

export interface ServerPollerConfig<T> {
  okIntervalMs: number
  fetch: () => Promise<T>
  applySuccess: (result: T) => void
  applyIdle: () => void
  onFailureStreak: () => void
}

export function createServerPoller<T>(config: ServerPollerConfig<T>): BackoffPoller {
  const coreStore = useCoreStore()

  return createBackoffPoller<T>({
    okIntervalMs: config.okIntervalMs,
    maxIntervalMs: MAX_INTERVAL_MS,
    failureThreshold: SERVER_POLL_FAILURE_THRESHOLD,
    watchSource: () => coreStore.projectConfig,
    isWatched: (): boolean => coreStore.isOnlineProject,
    shouldPoll: (): boolean => coreStore.isOnlineProject,
    fetch: config.fetch,
    applySuccess: config.applySuccess,
    applyIdle: config.applyIdle,
    onFailureStreak: config.onFailureStreak,
  })
}
