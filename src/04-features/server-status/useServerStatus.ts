import { watch } from 'vue'
import { useCoreStore } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'
import type { ProjectConfig } from '@/05-entities/core/types'

const POLL_INTERVAL_MS = 60_000

let pollTimer: ReturnType<typeof setInterval> | null = null
let syncStarted = false

export function useServerStatus(): {
  refreshServerStatus: () => Promise<void>
  startServerStatusSync: () => void
} {
  const coreStore = useCoreStore()

  const stopPolling = (): void => {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  const refreshServerStatus = async (): Promise<void> => {
    try {
      coreStore.serverStatus = await getServerStatus()
    } catch {
      coreStore.serverStatus = null
      stopPolling()
    }
  }

  const startPolling = (): void => {
    stopPolling()
    void refreshServerStatus()
    pollTimer = setInterval((): void => {
      void refreshServerStatus()
    }, POLL_INTERVAL_MS)
  }

  const syncWithProject = (config: ProjectConfig | null): void => {
    if (config?.online === true) {
      startPolling()
      return
    }
    stopPolling()
    coreStore.serverStatus = null
  }

  const startServerStatusSync = (): void => {
    if (syncStarted) return
    syncStarted = true
    watch(() => coreStore.projectConfig, syncWithProject)
  }

  return {
    refreshServerStatus,
    startServerStatusSync,
  }
}
