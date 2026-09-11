import { useAccountsStore } from '@/05-entities'
import { listenLaunchSteps } from '@/06-shared/api'
import { reportError } from '@/06-shared'
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
    const steps = store.launchSteps
    if (steps.length === 0) {
      store.activeProgress = 0
      return
    }
    let done = 0
    let fraction = 0
    for (const step of steps) {
      if (step.status !== 'active') {
        done++
      } else if (step.total > 0) {
        fraction = Math.min(step.current / step.total, 1)
      }
    }
    store.activeProgress = ((done + fraction) / steps.length) * 100
  }

  const apply = (event: StepEvent): void => {
    switch (event.type) {
      case 'started': {
        const active = store.launchSteps.find((step) => step.status === 'active')
        if (active) active.status = 'done'
        const step = findStep(event.id)
        if (step) {
          step.status = 'active'
          step.label = event.label
          step.shownAt = Date.now()
        } else {
          store.launchSteps.push({
            key: event.id,
            label: event.label,
            status: 'active',
            skipped: false,
            current: 0,
            total: 0,
            detail: '',
            error: '',
            shownAt: Date.now(),
          })
        }
        break
      }
      case 'progress': {
        const step = findStep(event.id)
        if (step) {
          step.current = event.current
          step.total = event.total
        }
        break
      }
      case 'detail': {
        const step = findStep(event.id)
        if (step) step.detail = event.text
        break
      }
      case 'finished': {
        const step = findStep(event.id)
        if (step) {
          step.status = 'done'
          step.skipped = event.skipped
          step.detail = ''
        }
        break
      }
      case 'failed': {
        const step = findStep(event.id)
        if (step) {
          step.status = 'error'
          step.error = event.message
          step.detail = ''
        }
        break
      }
    }
  }

  const processQueue = (): void => {
    if (flushTimer !== null) return

    while (eventQueue.length > 0) {
      const event = eventQueue[0]

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
      key: item.key,
      label: item.label,
      status: 'pending',
      skipped: false,
      current: 0,
      total: 0,
      detail: '',
      error: '',
      shownAt: 0,
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
