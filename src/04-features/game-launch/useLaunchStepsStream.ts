import { useAccountsStore, useCoreStore, type StepEvent, type StepProgressItem } from '@/05-entities'
import { getLaunchState, listenLaunchSteps } from '@/06-shared/api'
import { applyStepEvent, computeStepProgress, createStepItem, reportError } from '@/06-shared'

const MIN_DISPLAY_MS = 500
const FLUSH_TIMEOUT_MS = 5000
const FLUSH_POLL_MS = 50

let streamStarted = false
let eventQueue: StepEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastFinishedAt = 0
let failedSeen = false

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms) })

export function useLaunchStepsStream(): {
  startLaunchStepsStream: () => Promise<void>
  prefillLaunchSteps: (plan: { key: string; label: string }[]) => void
  resetLaunchSteps: () => void
  flushLaunchSteps: () => Promise<void>
} {
  const store = useAccountsStore()
  const coreStore = useCoreStore()

  const findStep = (key: string): StepProgressItem | undefined =>
    store.launchSteps.find((step) => step.key === key)

  const recomputeProgress = (): void => {
    store.activeProgress = computeStepProgress(store.launchSteps)
  }

  const apply = (event: StepEvent): void => {
    applyStepEvent(store.launchSteps, event)
    if (event.type === 'failed') {
      store.isLaunching = false
      store.launchInterrupted = false
      coreStore.loginError = event.message
    }
  }

  const holdForEvent = (event: StepEvent): number => {
    if (event.type === 'started') {
      if (lastFinishedAt === 0) return 0
      const elapsed = Date.now() - lastFinishedAt
      return elapsed < MIN_DISPLAY_MS ? MIN_DISPLAY_MS - elapsed : 0
    }
    if (event.type === 'finished' || event.type === 'failed') {
      const step = findStep(event.id)
      if (step === undefined) return 0
      const elapsed = Date.now() - step.shownAt
      return elapsed < MIN_DISPLAY_MS ? MIN_DISPLAY_MS - elapsed : 0
    }
    return 0
  }

  const processQueue = (): void => {
    if (failedSeen) {
      eventQueue = []
      return
    }
    if (flushTimer !== null) return

    while (eventQueue.length > 0) {
      const [event] = eventQueue
      if (event === undefined) break

      const hold = holdForEvent(event)
      if (hold > 0) {
        flushTimer = setTimeout((): void => {
          flushTimer = null
          processQueue()
        }, hold)
        return
      }

      if (event.type === 'finished') lastFinishedAt = Date.now()
      eventQueue.shift()
      apply(event)
      if (event.type === 'failed') {
        failedSeen = true
        eventQueue = []
        break
      }
    }

    recomputeProgress()
  }

  const clearQueueState = (): void => {
    eventQueue = []
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    lastFinishedAt = 0
    failedSeen = false
  }

  const prefillLaunchSteps = (plan: { key: string; label: string }[]): void => {
    clearQueueState()
    store.launchSteps = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending',
    }))
    store.activeProgress = 0
    store.launchInterrupted = false
  }

  const resetLaunchSteps = (): void => {
    clearQueueState()
    store.launchSteps = []
    store.activeProgress = 0
    store.launchInterrupted = false
  }

  const hydrateLaunchState = async (): Promise<void> => {
    let inProgress = false
    try {
      inProgress = await getLaunchState()
    } catch (e: unknown) {
      reportError('Не удалось получить состояние запуска игры', e)
      return
    }
    if (!inProgress || store.isLaunching || coreStore.gameUsername !== null) return
    store.isLaunching = true
    store.launchInterrupted = true
    store.launchSteps = []
    store.activeProgress = 0
  }

  const flushLaunchSteps = async (): Promise<void> => {
    const deadline = Date.now() + FLUSH_TIMEOUT_MS
    for (;;) {
      if (Date.now() >= deadline) break
      if (eventQueue.length === 0 && flushTimer === null) break
      if (flushTimer === null) processQueue()
      await delay(FLUSH_POLL_MS)
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    while (eventQueue.length > 0) {
      const [event] = eventQueue
      if (event === undefined) break
      if (event.type === 'finished') lastFinishedAt = Date.now()
      eventQueue.shift()
      apply(event)
      if (event.type === 'failed') {
        failedSeen = true
        eventQueue = []
        break
      }
    }
    recomputeProgress()
  }

  const startLaunchStepsStream = async (): Promise<void> => {
    if (streamStarted) return
    streamStarted = true

    try {
      await listenLaunchSteps((event: StepEvent) => {
        eventQueue.push(event)
        processQueue()
      })
    } catch (e: unknown) {
      streamStarted = false
      reportError('Не удалось запустить поток шагов запуска', e)
      return
    }
    await hydrateLaunchState()
  }

  return {
    startLaunchStepsStream,
    prefillLaunchSteps,
    resetLaunchSteps,
    flushLaunchSteps,
  }
}
