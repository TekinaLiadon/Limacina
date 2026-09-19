import { watch } from 'vue'
import { useCoreStore } from '@/05-entities'
import { pingLauncherServer } from '@/06-shared/api'

const OK_INTERVAL_MS = 30_000
const MAX_INTERVAL_MS = 300_000

let pollTimeout: ReturnType<typeof setTimeout> | null = null
let pollGeneration = 0
let syncStarted = false
let currentDelayMs = OK_INTERVAL_MS

export function useServerAvailability(): {
  startServerAvailabilitySync: () => void
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

  const poll = async (): Promise<void> => {
    if (!isWatched()) return
    const generation = pollGeneration
    try {
      const reachable = await pingLauncherServer()
      if (generation !== pollGeneration) return
      coreStore.isServerReachable = reachable
    } catch {
      if (generation !== pollGeneration) return
      coreStore.isServerReachable = false
    }
    if (coreStore.isServerReachable === false) {
      currentDelayMs = Math.min(currentDelayMs * 2, MAX_INTERVAL_MS)
    } else {
      currentDelayMs = OK_INTERVAL_MS
    }
    schedule(currentDelayMs)
  }

  const isWatched = (): boolean =>
    !coreStore.offlineBuild && coreStore.projectConfig?.online === true

  const syncWithProject = (): void => {
    stopPolling()
    if (isWatched()) {
      currentDelayMs = OK_INTERVAL_MS
      void poll()
      return
    }
    coreStore.isServerReachable = null
  }

  const startServerAvailabilitySync = (): void => {
    if (syncStarted) return
    syncStarted = true
    watch(() => coreStore.projectConfig, syncWithProject)
  }

  return {
    startServerAvailabilitySync,
  }
}
