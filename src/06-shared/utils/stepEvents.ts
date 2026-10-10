import type { StepEvent } from '../types'

export type StepStatus = 'pending' | 'active' | 'done' | 'error'

export interface StepProgressItem {
  key: string
  label: string
  status: StepStatus
  skipped: boolean
  untracked: boolean
  current: number
  total: number
  detail: string
  error: string
  shownAt: number
}

export function createStepItem(key: string, label: string, shownAt: number): StepProgressItem {
  return {
    key,
    label,
    status: 'active',
    skipped: false,
    untracked: false,
    current: 0,
    total: 0,
    detail: '',
    error: '',
    shownAt,
  }
}

export function applyStepEvent(steps: StepProgressItem[], event: StepEvent): void {
  switch (event.type) {
    case 'started': {
      const index = steps.findIndex((item) => item.key === event.id)
      const markLimit = index === -1 ? steps.length : index
      for (let i = 0; i < markLimit; i += 1) {
        const before = steps[i]
        if (
          before !== undefined &&
          (before.status === 'pending' || before.status === 'active')
        ) {
          before.status = 'done'
          before.skipped = true
        }
      }
      if (index === -1) {
        steps.push({ ...createStepItem(event.id, event.label, Date.now()), untracked: true })
        break
      }
      const step = steps[index]
      if (step) {
        step.status = 'active'
        step.label = event.label
        step.shownAt = Date.now()
      }
      break
    }
    case 'progress': {
      const step = steps.find((item) => item.key === event.id)
      if (step) {
        step.current = event.current
        step.total = event.total
      }
      break
    }
    case 'detail': {
      const step = steps.find((item) => item.key === event.id)
      if (step) step.detail = event.text
      break
    }
    case 'finished': {
      const step = steps.find((item) => item.key === event.id)
      if (step) {
        step.status = 'done'
        step.skipped = event.skipped
        step.detail = ''
      }
      break
    }
    case 'failed': {
      const step = steps.find((item) => item.key === event.id)
      if (step) {
        step.status = 'error'
        step.error = event.message
        step.detail = ''
      }
      break
    }
  }
}

export function computeStepProgress(steps: StepProgressItem[]): number {
  const tracked = steps.filter((step) => !step.untracked)
  if (tracked.length === 0) return 0
  let completed = 0
  for (const step of tracked) {
    if (step.status === 'done' || step.status === 'error') {
      completed += 1
    } else if (step.status === 'active' && step.total > 0) {
      completed += Math.min(step.current / step.total, 1)
    }
  }
  return Math.min(completed / tracked.length, 1) * 100
}
