import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useLaunchStore, useNotificationStore, type IntegrityReport, type StepEvent, type StepProgressItem } from '@/05-entities'
import { checkFilesIntegrity, getErrorMessage, listenIntegritySteps, type UnlistenFn } from '@/06-shared/api'
import { applyStepEvent, computeStepProgress, createStepItem, reportError, STEP_IDS, stepPlanItems, type StepPlanItem } from '@/06-shared'

const INTEGRITY_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.mcManifest,
  STEP_IDS.mcJar,
  STEP_IDS.mcLibs,
  STEP_IDS.mcAssetsIndex,
  STEP_IDS.mcAssets,
])

const SERVER_INTEGRITY_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.filesCheck,
  STEP_IDS.modsCheck,
])

const isCheckRunning = ref<boolean>(false)

export function isIntegrityCheckRunning(): boolean {
  return isCheckRunning.value
}

export function useIntegrityCheck(): {
  steps: Ref<StepProgressItem[]>
  progress: ComputedRef<number>
  isChecking: Ref<boolean>
  isPopupHidden: Ref<boolean>
  report: Ref<IntegrityReport | null>
  errorMessage: Ref<string>
  hasResult: ComputedRef<boolean>
  handleCheck: () => Promise<void>
  closeResult: () => void
} {
  const steps = ref<StepProgressItem[]>([])
  const isChecking = ref<boolean>(false)
  const isPopupHidden = ref<boolean>(false)
  const report = ref<IntegrityReport | null>(null)
  const errorMessage = ref<string>('')

  const coreStore = useCoreStore()
  const launch = useLaunchStore()
  const notification = useNotificationStore()

  const progress = computed((): number => computeStepProgress(steps.value))

  const hasResult = computed((): boolean => report.value !== null || errorMessage.value !== '')

  let unlisten: UnlistenFn | null = null
  let isUnmounted = false

  onBeforeUnmount(() => {
    isUnmounted = true
    unlisten?.()
    unlisten = null
  })

  const apply = (event: StepEvent): void => {
    applyStepEvent(steps.value, event)
  }

  const prefillSteps = (): void => {
    const online = coreStore.projectConfig?.online !== false
    const plan = online ? [...INTEGRITY_STEPS, ...SERVER_INTEGRITY_STEPS] : INTEGRITY_STEPS
    steps.value = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending',
    }))
  }

  const handleCheck = async (): Promise<void> => {
    if (isCheckRunning.value) {
      if (!isChecking.value) notification.show('Проверка целостности уже выполняется')
      return
    }
    if (launch.isLaunching) {
      notification.show('Идёт запуск игры, проверка целостности недоступна')
      return
    }
    isCheckRunning.value = true
    isChecking.value = true
    isPopupHidden.value = false
    prefillSteps()
    report.value = null
    errorMessage.value = ''

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
      if (isUnmounted) return
      report.value = result
      if (isPopupHidden.value) {
        notification.show(
          result.failed.length > 0
            ? `Проверка целостности: не удалось восстановить ${result.failed.length} файлов`
            : 'Проверка целостности: все файлы в порядке',
        )
      }
    } catch (e: unknown) {
      if (isUnmounted) return
      reportError('Проверка целостности файлов завершилась с ошибкой', e)
      errorMessage.value = getErrorMessage(e)
      if (isPopupHidden.value) notification.show(`Проверка целостности не удалась: ${errorMessage.value}`)
    } finally {
      isCheckRunning.value = false
      isChecking.value = false
    }
  }

  const closeResult = (): void => {
    isPopupHidden.value = true
    if (isChecking.value) return
    report.value = null
    errorMessage.value = ''
    steps.value = []
  }

  return {
    steps,
    progress,
    isChecking,
    isPopupHidden,
    report,
    errorMessage,
    hasResult,
    handleCheck,
    closeResult,
  }
}
