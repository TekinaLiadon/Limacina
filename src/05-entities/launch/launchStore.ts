import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { applyStepEvent, computeStepProgress, createStepItem, type StepEvent, type StepProgressItem, type StepPlanItem } from '@/06-shared'

export const useLaunchStore = defineStore('launch', () => {
  const isLaunching = ref<boolean>(false)
  const launchInterrupted = ref<boolean>(false)
  const isCancelPending = ref<boolean>(false)
  const isLaunchCommitted = ref<boolean>(false)
  const launchGeneration = ref<number>(0)
  const launchSteps = ref<StepProgressItem[]>([])
  const activeProgress = computed((): number => computeStepProgress(launchSteps.value))
  const loginError = ref<string>('')
  const gameUsernames = ref<string[]>([])
  const sessionViewDismissed = ref<boolean>(false)

  function addGameSession(username: string): void {
    if (!gameUsernames.value.includes(username)) {
      gameUsernames.value = [...gameUsernames.value, username]
    }
  }

  function removeGameSession(username: string): void {
    gameUsernames.value = gameUsernames.value.filter((name: string): boolean => name !== username)
  }

  function setGameSessions(usernames: string[]): void {
    for (const username of usernames) addGameSession(username)
    for (const username of [...gameUsernames.value]) {
      if (!usernames.includes(username)) removeGameSession(username)
    }
  }

  function beginLaunch(): number {
    isCancelPending.value = false
    isLaunchCommitted.value = false
    launchGeneration.value += 1
    isLaunching.value = true
    sessionViewDismissed.value = false
    return launchGeneration.value
  }

  function commitLaunch(): void {
    isLaunchCommitted.value = true
    isCancelPending.value = false
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
  }

  function prefillSteps(plan: StepPlanItem[]): void {
    launchSteps.value = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending' as const,
    }))
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
  }

  function resetSteps(): void {
    launchSteps.value = []
    launchInterrupted.value = false
  }

  function clearLoginError(): void {
    loginError.value = ''
  }

  function reset(): void {
    isLaunching.value = false
    launchInterrupted.value = false
    isCancelPending.value = false
    isLaunchCommitted.value = false
    launchSteps.value = []
    loginError.value = ''
    gameUsernames.value = []
    sessionViewDismissed.value = false
  }

  return {
    isLaunching,
    launchInterrupted,
    isCancelPending,
    isLaunchCommitted,
    launchGeneration,
    launchSteps,
    activeProgress,
    loginError,
    gameUsernames,
    sessionViewDismissed,
    beginLaunch,
    commitLaunch,
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
    resetSteps,
    clearLoginError,
    addGameSession,
    removeGameSession,
    setGameSessions,
    reset,
  }
})
