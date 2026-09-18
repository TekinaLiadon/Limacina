import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, type IntegrityReport, type StepEvent, type StepProgressItem } from '@/05-entities'
import { checkFilesIntegrity, getErrorMessage, listenIntegritySteps } from '@/06-shared/api'
import { applyStepEvent, computeStepProgress, createStepItem, reportError } from '@/06-shared'
import type { UnlistenFn } from '@tauri-apps/api/event'

const INTEGRITY_STEPS: { key: string; label: string }[] = [
  { key: 'mc.manifest', label: 'Загрузка манифеста версии' },
  { key: 'mc.jar', label: 'Клиент игры' },
  { key: 'mc.libs', label: 'Библиотеки игры' },
  { key: 'mc.assets.index', label: 'Загрузка индекса ресурсов' },
  { key: 'mc.assets', label: 'Загрузка ресурсов' },
]

const SERVER_INTEGRITY_STEPS: { key: string; label: string }[] = [
  { key: 'files.check', label: 'Файлы сервера' },
  { key: 'mods.check', label: 'Моды' },
]

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
  const notification = useNotificationStore()

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

  const prefillSteps = (): void => {
    const online = coreStore.projectConfig?.online !== false
    const plan = online ? [...INTEGRITY_STEPS, ...SERVER_INTEGRITY_STEPS] : INTEGRITY_STEPS
    steps.value = plan.map((item) => ({
      ...createStepItem(item.key, item.label, 0),
      status: 'pending',
    }))
  }

  const handleCheck = async (): Promise<void> => {
    if (isChecking.value) return
    isChecking.value = true
    isPopupHidden.value = false
    prefillSteps()
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
      if (checkId !== currentId || isUnmounted) return
      report.value = result
      if (isPopupHidden.value) {
        notification.show(
          result.failed.length > 0
            ? `Проверка целостности: не удалось восстановить ${result.failed.length} файлов`
            : 'Проверка целостности: все файлы в порядке',
        )
      }
    } catch (e: unknown) {
      if (checkId !== currentId || isUnmounted) return
      reportError('Проверка целостности файлов завершилась с ошибкой', e)
      errorMessage.value = getErrorMessage(e)
      if (isPopupHidden.value) notification.show(`Проверка целостности не удалась: ${errorMessage.value}`)
    } finally {
      if (checkId === currentId) isChecking.value = false
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
