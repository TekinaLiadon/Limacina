import type { StepEvent, StepProgressItem } from '@/05-entities/core/types'

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
        if (before !== undefined && before.status === 'pending') {
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
  let done = 0
  let fraction = 0
  for (const step of tracked) {
    if (step.status === 'done' || step.status === 'error') {
      done++
    } else if (step.status === 'active' && step.total > 0) {
      fraction = Math.min(step.current / step.total, 1)
    }
  }
  return ((done + fraction) / tracked.length) * 100
}
