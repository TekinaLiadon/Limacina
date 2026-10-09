import { useLaunchStore, useCoreStore, type StepEvent } from '@/05-entities'
import { getLaunchState, listenLaunchSteps } from '@/06-shared/api'
import { createSingletonListeners, reportError, type StepPlanItem } from '@/06-shared'
import { syncGameSession } from '../game-session/useGameSession'

const MIN_DISPLAY_MS = 500
const FLUSH_TIMEOUT_MS = 5000
const FLUSH_POLL_MS = 50

const launchStepsListeners = createSingletonListeners()
let eventQueue: StepEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastFinishedAt = 0
let failedSeen = false
let activeGeneration: number | null = null

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms) })

export function useLaunchStepsStream(): {
  startLaunchStepsStream: () => Promise<void>
  prefillLaunchSteps: (plan: StepPlanItem[]) => void
  resetLaunchSteps: () => void
  flushLaunchSteps: () => Promise<void>
} {
  const launch = useLaunchStore()
  const coreStore = useCoreStore()

  const apply = (event: StepEvent): void => {
    if (activeGeneration === null || launch.launchGeneration !== activeGeneration) return
    launch.applyStreamEvent(event)
  }

  const holdForEvent = (event: StepEvent): number => {
    if (event.type === 'started') {
      if (lastFinishedAt === 0) return 0
      const elapsed = Date.now() - lastFinishedAt
      return elapsed < MIN_DISPLAY_MS ? MIN_DISPLAY_MS - elapsed : 0
    }
    if (event.type === 'finished' || event.type === 'failed') {
      const step = launch.launchSteps.find((item) => item.key === event.id)
      if (step === undefined) return 0
      const elapsed = Date.now() - step.shownAt
      return elapsed < MIN_DISPLAY_MS ? MIN_DISPLAY_MS - elapsed : 0
    }
    return 0
  }

  const drainNextEvent = (): boolean => {
    const [event] = eventQueue
    if (event === undefined) return false
    if (event.type === 'finished') lastFinishedAt = Date.now()
    eventQueue.shift()
    apply(event)
    if (event.type === 'failed') {
      failedSeen = true
      eventQueue = []
      return false
    }
    return true
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

      if (!drainNextEvent()) break
    }

    launch.recomputeProgress()
  }

  const clearQueueState = (): void => {
    eventQueue = []
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    lastFinishedAt = 0
    failedSeen = false
    activeGeneration = null
  }

  const prefillLaunchSteps = (plan: StepPlanItem[]): void => {
    clearQueueState()
    activeGeneration = launch.launchGeneration
    launch.prefillSteps(plan)
  }

  const resetLaunchSteps = (): void => {
    clearQueueState()
    launch.resetSteps()
  }

  const hydrateLaunchState = async (): Promise<void> => {
    try {
      await syncGameSession()
    } catch (e: unknown) {
      reportError('Не удалось дождаться синхронизации игровой сессии', e)
    }
    let inProgress = false
    try {
      inProgress = await getLaunchState()
    } catch (e: unknown) {
      reportError('Не удалось получить состояние запуска игры', e)
      return
    }
    if (!inProgress || launch.isLaunching || coreStore.gameUsername !== null) return
    launch.markInterrupted()
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
      if (!drainNextEvent()) break
    }
    launch.recomputeProgress()
  }

  const startLaunchStepsStream = async (): Promise<void> => {
    try {
      await launchStepsListeners.start(async (track): Promise<void> => {
        track(await listenLaunchSteps((event: StepEvent): void => {
          eventQueue.push(event)
          processQueue()
        }))
        await hydrateLaunchState()
      })
    } catch (e: unknown) {
      reportError('Не удалось запустить поток шагов запуска', e)
    }
  }

  return {
    startLaunchStepsStream,
    prefillLaunchSteps,
    resetLaunchSteps,
    flushLaunchSteps,
  }
}
