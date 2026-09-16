import { watch } from 'vue'
import { useCoreStore, type ProjectConfig } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'

const OK_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 300_000
const FAILURE_THRESHOLD = 3

let pollTimeout: ReturnType<typeof setTimeout> | null = null
let syncStarted = false
let currentDelayMs = OK_INTERVAL_MS
let consecutiveFailures = 0

export function useServerStatus(): {
  refreshServerStatus: () => Promise<void>
  startServerStatusSync: () => void
} {
  const coreStore = useCoreStore()

  const stopPolling = (): void => {
    if (pollTimeout === null) return
    clearTimeout(pollTimeout)
    pollTimeout = null
  }

  const schedule = (delayMs: number): void => {
    stopPolling()
    pollTimeout = setTimeout((): void => {
      void poll()
    }, delayMs)
  }

  const resetBackoff = (): void => {
    consecutiveFailures = 0
    currentDelayMs = OK_INTERVAL_MS
  }

  const fetchStatus = async (): Promise<void> => {
    try {
      coreStore.serverStatus = await getServerStatus()
      resetBackoff()
    } catch {
      consecutiveFailures += 1
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        coreStore.serverStatus = null
      }
      currentDelayMs = Math.min(currentDelayMs * 2, MAX_INTERVAL_MS)
    }
  }

  const poll = async (): Promise<void> => {
    await fetchStatus()
    schedule(currentDelayMs)
  }

  const syncWithProject = (config: ProjectConfig | null): void => {
    if (config?.online === true) {
      resetBackoff()
      void poll()
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
    refreshServerStatus: fetchStatus,
    startServerStatusSync,
  }
}
