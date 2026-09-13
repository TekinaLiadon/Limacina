import { useAccountsStore } from '@/05-entities'
import { listenLaunchSteps } from '@/06-shared/api'
import { applyStepEvent, computeStepProgress, createStepItem, reportError } from '@/06-shared'
import type { StepEvent, StepProgressItem } from '@/05-entities/core/types'

const MIN_DISPLAY_MS = 1000
const DONE_SETTLE_MS = 200

let streamStarted = false
let eventQueue: StepEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastFinishedAt = 0

export function useLaunchStepsStream(): {
  startLaunchStepsStream: () => Promise<void>
  prefillLaunchSteps: (plan: { key: string; label: string }[]) => void
  resetLaunchSteps: () => void
} {
  const store = useAccountsStore()

  const findStep = (key: string): StepProgressItem | undefined =>
    store.launchSteps.find((step) => step.key === key)

  const recomputeProgress = (): void => {
    store.activeProgress = computeStepProgress(store.launchSteps)
  }

  const apply = (event: StepEvent): void => {
    applyStepEvent(store.launchSteps, event)
  }

  const processQueue = (): void => {
    if (flushTimer !== null) return

    while (eventQueue.length > 0) {
      const [event] = eventQueue
      if (event === undefined) break

      if (event.type === 'finished') {
        const step = findStep(event.id)
        const elapsed =
          step && step.status === 'active' ? Date.now() - step.shownAt : MIN_DISPLAY_MS
        const hold =
          elapsed < MIN_DISPLAY_MS ? MIN_DISPLAY_MS - elapsed : DONE_SETTLE_MS - (Date.now() - lastFinishedAt)
        if (hold > 0) {
          flushTimer = setTimeout((): void => {
            flushTimer = null
            processQueue()
          }, hold)
          return
        }
        lastFinishedAt = Date.now()
      }

      eventQueue.shift()
      apply(event)
    }

    recomputeProgress()
  }

  const prefillLaunchSteps = (plan: { key: string; label: string }[]): void => {
    eventQueue = []
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    store.launchSteps = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending',
    }))
    store.activeProgress = 0
  }

  const resetLaunchSteps = (): void => {
    eventQueue = []
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    store.launchSteps = []
    store.activeProgress = 0
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
    }
  }

  return {
    startLaunchStepsStream,
    prefillLaunchSteps,
    resetLaunchSteps,
  }
}
