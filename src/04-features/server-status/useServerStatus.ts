import { useCoreStore, type ServerStatus } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'
import type { BackoffPoller } from '@/06-shared'
import { createServerPoller } from '../server-polling/createServerPoller'

const OK_INTERVAL_MS = 60_000

let poller: BackoffPoller | null = null

export function useServerStatus(): {
  startServerStatusSync: () => void
} {
  const coreStore = useCoreStore()

  if (poller === null) {
    poller = createServerPoller<ServerStatus>({
      okIntervalMs: OK_INTERVAL_MS,
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
