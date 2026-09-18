import { watch } from 'vue'
import { useCoreStore, type ProjectConfig } from '@/05-entities'
import { getServerStatus } from '@/06-shared/api'

const OK_INTERVAL_MS = 60_000
const MAX_INTERVAL_MS = 300_000
const FAILURE_THRESHOLD = 3

let pollTimeout: ReturnType<typeof setTimeout> | null = null
let pollGeneration = 0
let syncStarted = false
let currentDelayMs = OK_INTERVAL_MS
let consecutiveFailures = 0

export function useServerStatus(): {
  refreshServerStatus: () => Promise<void>
  startServerStatusSync: () => void
} {
  const coreStore = useCoreStore()

  const stopPolling = (): void => {
    pollGeneration += 1
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

  const fetchStatus = async (generation: number): Promise<void> => {
    try {
      const status = await getServerStatus()
      if (generation !== pollGeneration) return
      coreStore.serverStatus = status
      resetBackoff()
    } catch {
      if (generation !== pollGeneration) return
      consecutiveFailures += 1
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        coreStore.serverStatus = null
      }
      currentDelayMs = Math.min(currentDelayMs * 2, MAX_INTERVAL_MS)
    }
  }

  const poll = async (): Promise<void> => {
    const generation = pollGeneration
    await fetchStatus(generation)
    if (generation !== pollGeneration) return
    schedule(currentDelayMs)
  }

  const syncWithProject = (config: ProjectConfig | null): void => {
    stopPolling()
    if (config?.online === true) {
      resetBackoff()
      void poll()
      return
    }
    coreStore.serverStatus = null
  }

  const startServerStatusSync = (): void => {
    if (syncStarted) return
    syncStarted = true
    watch(() => coreStore.projectConfig, syncWithProject)
  }

  return {
    refreshServerStatus: (): Promise<void> => fetchStatus(pollGeneration),
    startServerStatusSync,
  }
}
