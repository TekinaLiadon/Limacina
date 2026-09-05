import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { IntegrityReport, StepEvent, StepProgressItem } from '@/05-entities/core/types'
import { checkFilesIntegrity, listenIntegritySteps } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import type { UnlistenFn } from '@tauri-apps/api/event'

export function useIntegrityCheck(): {
  steps: Ref<StepProgressItem[]>
  progress: ComputedRef<number>
  isChecking: Ref<boolean>
  report: Ref<IntegrityReport | null>
  errorMessage: Ref<string>
  hasResult: ComputedRef<boolean>
  handleCheck: () => Promise<void>
  closeResult: () => void
} {
  const steps = ref<StepProgressItem[]>([])
  const isChecking = ref<boolean>(false)
  const report = ref<IntegrityReport | null>(null)
  const errorMessage = ref<string>('')

  const progress = computed((): number => {
    if (steps.value.length === 0) return 0
    let done = 0
    let fraction = 0
    for (const step of steps.value) {
      if (step.status !== 'active') {
        done++
      } else if (step.total > 0) {
        fraction = Math.min(step.current / step.total, 1)
      }
    }
    return ((done + fraction) / steps.value.length) * 100
  })

  const hasResult = computed((): boolean => report.value !== null || errorMessage.value !== '')

  let unlisten: UnlistenFn | null = null
  let currentId = 0

  const apply = (event: StepEvent): void => {
    switch (event.type) {
      case 'started': {
        const active = steps.value.find((step) => step.status === 'active')
        if (active) active.status = 'done'
        steps.value.push({
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
        break
      }
      case 'progress': {
        const step = steps.value.find((s) => s.key === event.id)
        if (step) {
          step.current = event.current
          step.total = event.total
        }
        break
      }
      case 'detail': {
        const step = steps.value.find((s) => s.key === event.id)
        if (step) step.detail = event.text
        break
      }
      case 'finished': {
        const step = steps.value.find((s) => s.key === event.id)
        if (step) {
          step.status = 'done'
          step.skipped = event.skipped
          step.detail = ''
        }
        break
      }
      case 'failed': {
        const step = steps.value.find((s) => s.key === event.id)
        if (step) {
          step.status = 'error'
          step.error = event.message
          step.detail = ''
        }
        break
      }
    }
  }

  const handleCheck = async (): Promise<void> => {
    if (isChecking.value) return
    isChecking.value = true
    steps.value = []
    report.value = null
    errorMessage.value = ''
    const checkId = ++currentId

    try {
      if (unlisten === null) {
        unlisten = await listenIntegritySteps((event: StepEvent) => {
          if (isChecking.value) apply(event)
        })
        // TODO unlisten
      }
      const result = await checkFilesIntegrity()
      if (checkId !== currentId) return
      report.value = result
    } catch (e: unknown) {
      if (checkId !== currentId) return
      reportError('Проверка целостности файлов завершилась с ошибкой', e)
      errorMessage.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (checkId === currentId) isChecking.value = false
    }
  }

  const closeResult = (): void => {
    report.value = null
    errorMessage.value = ''
    steps.value = []
  }

  return {
    steps,
    progress,
    isChecking,
    report,
    errorMessage,
    hasResult,
    handleCheck,
    closeResult,
  }
}
