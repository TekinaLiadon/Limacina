import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useLaunchStore, useNotificationStore, type IntegrityReport, type StepEvent, type StepProgressItem } from '@/05-entities'
import { checkFilesIntegrity, getErrorMessage, listenIntegritySteps, type UnlistenFn } from '@/06-shared/api'
import { applyStepEvent, captureProjectScope, computeStepProgress, createStepItem, formatCount, reportError, STEP_IDS, stepPlanItems, type PluralForms, type ProjectScope, type StepPlanItem } from '@/06-shared'

const INTEGRITY_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.mcManifest,
  STEP_IDS.mcJar,
  STEP_IDS.mcLibs,
  STEP_IDS.mcNatives,
  STEP_IDS.mcAssetsIndex,
  STEP_IDS.mcAssets,
])

const SERVER_INTEGRITY_STEPS: StepPlanItem[] = stepPlanItems([STEP_IDS.modsCheck])

const FILE_FORMS: PluralForms = { one: 'файл', few: 'файла', many: 'файлов' }

const isCheckRunning = ref<boolean>(false)
const steps = ref<StepProgressItem[]>([])
const isChecking = ref<boolean>(false)
const isPopupHidden = ref<boolean>(false)
const report = ref<IntegrityReport | null>(null)
const errorMessage = ref<string>('')

let unlisten: UnlistenFn | null = null
let activeScope: ProjectScope | null = null

export function isIntegrityCheckRunning(): boolean {
  return isCheckRunning.value
}

export function useIntegrityCheck(): {
  steps: Ref<StepProgressItem[]>
  progress: ComputedRef<number>
  isChecking: Ref<boolean>
  isCheckingNow: ComputedRef<boolean>
  isPopupHidden: Ref<boolean>
  report: Ref<IntegrityReport | null>
  errorMessage: Ref<string>
  hasResult: ComputedRef<boolean>
  hasErrors: ComputedRef<boolean>
  isClean: ComputedRef<boolean>
  resultText: ComputedRef<string>
  handleCheck: () => Promise<void>
  closeResult: () => void
} {
  const coreStore = useCoreStore()
  const launch = useLaunchStore()
  const notification = useNotificationStore()

  const progress = computed((): number => computeStepProgress(steps.value))

  const hasResult = computed((): boolean => report.value !== null || errorMessage.value !== '')

  const isCheckingNow = computed((): boolean =>
    isChecking.value || steps.value.some((step) => step.status === 'active'),
  )

  const hasErrors = computed((): boolean => report.value !== null && report.value.failed.length > 0)

  const isClean = computed((): boolean => report.value !== null && report.value.failed.length === 0)

  const resultText = computed((): string => {
    const { value } = report
    if (value === null) return ''
    const parts: string[] = [`проверено: ${value.total}`]
    if (value.broken > 0) parts.push(`повреждено: ${value.broken}`)
    if (value.missing > 0) parts.push(`отсутствовало: ${value.missing}`)
    if (value.repaired > 0) parts.push(`восстановлено: ${value.repaired}`)
    return parts.join(', ')
  })

  const apply = (event: StepEvent): void => {
    applyStepEvent(steps.value, event)
  }

  const prefillSteps = (): void => {
    const online = coreStore.projectConfig?.online === true
    const plan = online ? [...INTEGRITY_STEPS, ...SERVER_INTEGRITY_STEPS] : INTEGRITY_STEPS
    steps.value = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending',
    }))
  }

  const resetResult = (): void => {
    steps.value = []
    report.value = null
    errorMessage.value = ''
  }

  const handleCheck = async (): Promise<void> => {
    if (isCheckRunning.value) {
      notification.show('Проверка целостности уже выполняется')
      return
    }
    if (launch.isLaunching) {
      notification.show('Идёт запуск игры, проверка целостности недоступна')
      return
    }
    const scope = captureProjectScope((): string => coreStore.currentProject)
    activeScope = scope
    isCheckRunning.value = true
    isChecking.value = true
    isPopupHidden.value = false
    prefillSteps()
    report.value = null
    errorMessage.value = ''

    const abortOnProjectSwitch = (): boolean => {
      if (scope.isCurrent()) return false
      notification.show('Проверка целостности прервана: проект переключён')
      resetResult()
      return true
    }

    try {
      if (unlisten === null) {
        unlisten = await listenIntegritySteps((event: StepEvent) => {
          if (isChecking.value && activeScope !== null && activeScope.isCurrent()) apply(event)
        })
      }
      const result = await checkFilesIntegrity()
      if (abortOnProjectSwitch()) return
      report.value = result
      if (isPopupHidden.value) {
        notification.show(
          result.failed.length > 0
            ? `Проверка целостности: не удалось восстановить ${formatCount(result.failed.length, FILE_FORMS)}`
            : 'Проверка целостности: все файлы в порядке',
        )
      }
    } catch (e: unknown) {
      if (abortOnProjectSwitch()) return
      reportError('Проверка целостности файлов завершилась с ошибкой', e)
      errorMessage.value = getErrorMessage(e)
      if (isPopupHidden.value) notification.show(`Проверка целостности не удалась: ${errorMessage.value}`)
    } finally {
      isCheckRunning.value = false
      isChecking.value = false
      activeScope = null
    }
  }

  const closeResult = (): void => {
    isPopupHidden.value = true
    if (isChecking.value) return
    resetResult()
  }

  return {
    steps,
    progress,
    isChecking,
    isCheckingNow,
    isPopupHidden,
    report,
    errorMessage,
    hasResult,
    hasErrors,
    isClean,
    resultText,
    handleCheck,
    closeResult,
  }
}
