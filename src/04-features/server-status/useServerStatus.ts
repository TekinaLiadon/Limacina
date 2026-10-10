import { useServerStore, type ServerStatus } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'
import type { BackoffPoller } from '@/06-shared'
import { createServerPoller } from '../server-polling/createServerPoller'

const OK_INTERVAL_MS = 60_000

let poller: BackoffPoller | null = null

export function useServerStatus(): {
  startServerStatusSync: () => void
} {
  const serverStore = useServerStore()

  if (poller === null) {
    poller = createServerPoller<ServerStatus>({
      okIntervalMs: OK_INTERVAL_MS,
      fetch: getServerStatus,
      applySuccess: (status: ServerStatus): void => {
        serverStore.serverStatus = status
      },
      applyIdle: (): void => {
        serverStore.serverStatus = null
      },
      onFailureStreak: (): void => {
        serverStore.serverStatus = null
      },
    })
  }

  return {
    startServerStatusSync: poller.startSync,
  }
}
