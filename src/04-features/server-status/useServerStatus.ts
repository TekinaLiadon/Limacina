import { useCoreStore } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'

const POLL_INTERVAL_MS = 60_000

export function useServerStatus(): {
  refreshServerStatus: () => Promise<void>
  startServerStatusPolling: () => void
} {
  const coreStore = useCoreStore()

  const refreshServerStatus = async (): Promise<void> => {
    try {
      coreStore.serverStatus = await getServerStatus()
    } catch {
      coreStore.serverStatus = null
    }
  }

  const startServerStatusPolling = (): void => {
    void refreshServerStatus()
    setInterval((): void => {
      void refreshServerStatus()
    }, POLL_INTERVAL_MS)
  }

  return {
    refreshServerStatus,
    startServerStatusPolling,
  }
}
