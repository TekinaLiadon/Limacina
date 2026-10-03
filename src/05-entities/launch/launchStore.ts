import { defineStore } from 'pinia'
import type { StepEvent, StepProgressItem } from '../core/types'
import { applyStepEvent, computeStepProgress, createStepItem, type StepPlanItem } from '@/06-shared'

export interface LaunchState {
  isLaunching: boolean
  launchInterrupted: boolean
  isCancelPending: boolean
  launchGeneration: number
  launchSteps: StepProgressItem[]
  activeProgress: number
  loginError: string
}

export const useLaunchStore = defineStore('launch', {
  state: (): LaunchState => ({
    isLaunching: false,
    launchInterrupted: false,
    isCancelPending: false,
    launchGeneration: 0,
    launchSteps: [],
    activeProgress: 0,
    loginError: '',
  }),

  actions: {
    beginLaunch(): number {
      this.isCancelPending = false
      this.launchGeneration += 1
      this.isLaunching = true
      return this.launchGeneration
    },

    invalidateGeneration(): void {
      this.launchGeneration += 1
    },

    isCurrent(generation: number): boolean {
      return this.launchGeneration === generation
    },

    reportFailure(generation: number, message: string): void {
      if (!this.isCurrent(generation)) return
      this.loginError = message
      this.isLaunching = false
    },

    failActive(message: string): void {
      this.loginError = message
      this.isLaunching = false
      this.launchInterrupted = false
    },

    failActiveStep(message: string): void {
      const step = this.launchSteps.find((item) => item.status === 'active')
      if (step) {
        step.status = 'error'
        step.error = message
      } else {
        this.activeProgress = 0
      }
      this.loginError = message
      this.isLaunching = false
      this.launchInterrupted = false
    },

    finishLaunch(): void {
      this.isLaunching = false
    },

    cancelLaunch(): void {
      this.isCancelPending = false
      this.isLaunching = false
      this.loginError = ''
    },

    setCancelPending(value: boolean): void {
      this.isCancelPending = value
    },

    markInterrupted(): void {
      this.isLaunching = true
      this.launchInterrupted = true
      this.launchSteps = []
      this.activeProgress = 0
    },

    prefillSteps(plan: StepPlanItem[]): void {
      this.launchSteps = plan.map((item) => ({
        ...createStepItem(item.key, item.label, 0),
        status: 'pending' as const,
      }))
      this.activeProgress = 0
      this.launchInterrupted = false
    },

    applyStreamEvent(event: StepEvent): void {
      applyStepEvent(this.launchSteps, event)
    },

    markStepsSkipped(keys: ReadonlySet<string>): void {
      for (const item of this.launchSteps) {
        if (keys.has(item.key)) {
          item.status = 'done'
          item.skipped = true
        }
      }
      this.activeProgress = computeStepProgress(this.launchSteps)
    },

    recomputeProgress(): void {
      this.activeProgress = computeStepProgress(this.launchSteps)
    },

    resetSteps(): void {
      this.launchSteps = []
      this.activeProgress = 0
      this.launchInterrupted = false
    },

    clearLoginError(): void {
      this.loginError = ''
    },

    reset(): void {
      this.isLaunching = false
      this.launchInterrupted = false
      this.isCancelPending = false
      this.launchSteps = []
      this.activeProgress = 0
      this.loginError = ''
    },
  },
})
