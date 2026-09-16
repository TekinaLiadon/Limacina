import type { StepEvent, StepProgressItem } from '@/05-entities'

export function createStepItem(key: string, label: string, shownAt: number): StepProgressItem {
  return {
    key,
    label,
    status: 'active',
    skipped: false,
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
      const active = steps.find((step) => step.status === 'active')
      if (active) active.status = 'done'
      const index = steps.findIndex((item) => item.key === event.id)
      if (index === -1) {
        steps.push(createStepItem(event.id, event.label, Date.now()))
        break
      }
      const step = steps[index]
      if (step) {
        step.status = 'active'
        step.label = event.label
        step.shownAt = Date.now()
      }
      for (let i = 0; i < index; i += 1) {
        const before = steps[i]
        if (before !== undefined && before.status === 'pending') {
          before.status = 'done'
          before.skipped = true
        }
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
  if (steps.length === 0) return 0
  let done = 0
  let fraction = 0
  for (const step of steps) {
    if (step.status === 'done' || step.status === 'error') {
      done++
    } else if (step.status === 'active' && step.total > 0) {
      fraction = Math.min(step.current / step.total, 1)
    }
  }
  return ((done + fraction) / steps.length) * 100
}
