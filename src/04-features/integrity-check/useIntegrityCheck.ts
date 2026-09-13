import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { IntegrityReport, StepEvent, StepProgressItem } from '@/05-entities/core/types'
import { checkFilesIntegrity, listenIntegritySteps } from '@/06-shared/api'
import { applyStepEvent, computeStepProgress, reportError } from '@/06-shared'
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

  const progress = computed((): number => computeStepProgress(steps.value))

  const hasResult = computed((): boolean => report.value !== null || errorMessage.value !== '')

  let unlisten: UnlistenFn | null = null
  let currentId = 0
  let isUnmounted = false

  onBeforeUnmount(() => {
    isUnmounted = true
    unlisten?.()
    unlisten = null
  })

  const apply = (event: StepEvent): void => {
    applyStepEvent(steps.value, event)
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
        const fn = await listenIntegritySteps((event: StepEvent) => {
          if (isChecking.value) apply(event)
        })
        if (isUnmounted) {
          fn()
          return
        }
        unlisten = fn
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
