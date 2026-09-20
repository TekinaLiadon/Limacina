import { watch, type WatchSource } from 'vue'

export interface BackoffPollerConfig<T> {
  okIntervalMs: number
  maxIntervalMs: number
  watchSource: WatchSource
  isWatched: () => boolean
  fetch: () => Promise<T>
  applySuccess: (result: T) => void
  applyError?: () => void
  applyIdle: () => void
  shouldPoll?: () => boolean
  failureThreshold?: number
  onFailureStreak?: () => void
}

export interface BackoffPoller {
  poll: () => Promise<void>
  fetchOnce: () => Promise<void>
  startSync: () => void
}

export function createBackoffPoller<T>(config: BackoffPollerConfig<T>): BackoffPoller {
  const {
    okIntervalMs,
    maxIntervalMs,
    watchSource,
    isWatched,
    fetch,
    applySuccess,
    applyError,
    applyIdle,
    shouldPoll,
    failureThreshold,
    onFailureStreak,
  } = config

  let pollTimeout: ReturnType<typeof setTimeout> | null = null
  let pollGeneration = 0
  let currentDelayMs = okIntervalMs
  let consecutiveFailures = 0
  let syncStarted = false

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
    currentDelayMs = okIntervalMs
  }

  const runCycle = async (generation: number): Promise<void> => {
    let succeeded = false
    try {
      const result = await fetch()
      if (generation !== pollGeneration) return
      applySuccess(result)
      succeeded = true
    } catch {
      if (generation !== pollGeneration) return
      applyError?.()
    }
    if (succeeded) {
      resetBackoff()
      return
    }
    consecutiveFailures += 1
    if (failureThreshold !== undefined && consecutiveFailures >= failureThreshold) {
      onFailureStreak?.()
    }
    currentDelayMs = Math.min(currentDelayMs * 2, maxIntervalMs)
  }

  const poll = async (): Promise<void> => {
    if (shouldPoll !== undefined && !shouldPoll()) return
    const generation = pollGeneration
    await runCycle(generation)
    if (generation !== pollGeneration) return
    schedule(currentDelayMs)
  }

  const fetchOnce = async (): Promise<void> => {
    await runCycle(pollGeneration)
  }

  const syncWithProject = (): void => {
    stopPolling()
    if (!isWatched()) {
      applyIdle()
      return
    }
    resetBackoff()
    void poll()
  }

  const startSync = (): void => {
    if (syncStarted) return
    syncStarted = true
    watch(watchSource, syncWithProject)
  }

  return { poll, fetchOnce, startSync }
}
