import { watch, type WatchSource } from 'vue'
import { reportError } from './reportError'

export interface BackoffPollerConfig<T> {
  okIntervalMs: number
  maxIntervalMs: number
  watchSource: WatchSource
  isWatched: () => boolean
  fetch: () => Promise<T>
  applySuccess: (result: T) => void
  applyError?: (error: unknown) => void
  applyIdle: () => void
  shouldPoll?: () => boolean
  failureThreshold?: number
  onFailureStreak?: () => void
}

export interface BackoffPoller {
  startSync: () => void
}

const guardApply = (run: () => void): void => {
  try {
    run()
  } catch (e: unknown) {
    reportError('Сбой обработчика цикла опроса', e)
  }
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
      guardApply((): void => { applySuccess(result) })
      succeeded = true
    } catch (e: unknown) {
      if (generation !== pollGeneration) return
      if (applyError !== undefined) guardApply((): void => { applyError(e) })
    }
    if (succeeded) {
      resetBackoff()
      return
    }
    consecutiveFailures += 1
    if (failureThreshold !== undefined && consecutiveFailures >= failureThreshold) {
      guardApply((): void => { onFailureStreak?.() })
    }
    currentDelayMs = Math.min(currentDelayMs * 2, maxIntervalMs)
  }

  const poll = async (): Promise<void> => {
    const generation = pollGeneration
    try {
      if (shouldPoll !== undefined && !shouldPoll()) {
        schedule(okIntervalMs)
        return
      }
      await runCycle(generation)
    } finally {
      if (generation === pollGeneration) schedule(currentDelayMs)
    }
  }

  const syncWithProject = (): void => {
    stopPolling()
    if (!isWatched()) {
      guardApply(applyIdle)
      return
    }
    resetBackoff()
    void poll()
  }

  const startSync = (): void => {
    if (syncStarted) return
    syncStarted = true
    watch(watchSource, syncWithProject)
    syncWithProject()
  }

  return { startSync }
}
