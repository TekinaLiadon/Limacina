import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { StepEvent, StepProgressItem } from '../core/types'
import { applyStepEvent, computeStepProgress, createStepItem, type StepPlanItem } from '@/06-shared'

export const useLaunchStore = defineStore('launch', () => {
  const isLaunching = ref<boolean>(false)
  const launchInterrupted = ref<boolean>(false)
  const isCancelPending = ref<boolean>(false)
  const launchGeneration = ref<number>(0)
  const launchSteps = ref<StepProgressItem[]>([])
  const activeProgress = ref<number>(0)
  const loginError = ref<string>('')
  const gameUsername = ref<string | null>(null)

  function beginLaunch(): number {
    isCancelPending.value = false
    launchGeneration.value += 1
    isLaunching.value = true
    return launchGeneration.value
  }

  function invalidateGeneration(): void {
    launchGeneration.value += 1
  }

  function isCurrent(generation: number): boolean {
    return launchGeneration.value === generation
  }

  function reportFailure(generation: number, message: string): void {
    if (!isCurrent(generation)) return
    loginError.value = message
    isLaunching.value = false
  }

  function failActive(message: string): void {
    loginError.value = message
    isLaunching.value = false
    launchInterrupted.value = false
  }

  function failActiveStep(message: string): void {
    const step = launchSteps.value.find((item) => item.status === 'active')
    if (step) {
      step.status = 'error'
      step.error = message
    } else {
      activeProgress.value = 0
    }
    failActive(message)
  }

  function finishLaunch(): void {
    isLaunching.value = false
  }

  function cancelLaunch(): void {
    isCancelPending.value = false
    isLaunching.value = false
    loginError.value = ''
  }

  function setCancelPending(value: boolean): void {
    isCancelPending.value = value
  }

  function markInterrupted(): void {
    isLaunching.value = true
    launchInterrupted.value = true
    launchSteps.value = []
    activeProgress.value = 0
  }

  function prefillSteps(plan: StepPlanItem[]): void {
    launchSteps.value = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending' as const,
    }))
    activeProgress.value = 0
    launchInterrupted.value = false
  }

  function applyStreamEvent(event: StepEvent): void {
    applyStepEvent(launchSteps.value, event)
  }

  function markStepsSkipped(keys: ReadonlySet<string>): void {
    for (const item of launchSteps.value) {
      if (keys.has(item.key)) {
        item.status = 'done'
        item.skipped = true
      }
    }
    activeProgress.value = computeStepProgress(launchSteps.value)
  }

  function recomputeProgress(): void {
    activeProgress.value = computeStepProgress(launchSteps.value)
  }

  function resetSteps(): void {
    launchSteps.value = []
    activeProgress.value = 0
    launchInterrupted.value = false
  }

  function clearLoginError(): void {
    loginError.value = ''
  }

  function reset(): void {
    isLaunching.value = false
    launchInterrupted.value = false
    isCancelPending.value = false
    launchSteps.value = []
    activeProgress.value = 0
    loginError.value = ''
  }

  return {
    isLaunching,
    launchInterrupted,
    isCancelPending,
    launchGeneration,
    launchSteps,
    activeProgress,
    loginError,
    gameUsername,
    beginLaunch,
    invalidateGeneration,
    isCurrent,
    reportFailure,
    failActive,
    failActiveStep,
    finishLaunch,
    cancelLaunch,
    setCancelPending,
    markInterrupted,
    prefillSteps,
    applyStreamEvent,
    markStepsSkipped,
    recomputeProgress,
    resetSteps,
    clearLoginError,
    reset,
  }
})
