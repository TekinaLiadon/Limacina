import { ref } from 'vue'
import {
  cancelAlternativeJava,
  downloadAlternativeJava,
  getCommandError,
  getErrorMessage,
  getJavaDistributions,
  getJavaVersion,
  listenJavaDownloadSteps,
  type UnlistenFn,
} from '@/06-shared/api'
import { reportError, STEP_IDS, useAsyncRaceGuard } from '@/06-shared'
import { useNotificationStore, type JavaDistribution, type StepEvent } from '@/05-entities'
import { useSystemNotifications } from '@/04-features/system-notifications/useSystemNotifications'

export type AlternativeJavaDownloadResult =
  | 'replaced'
  | 'downloaded'
  | 'failed'
  | 'unavailable'
  | 'busy'

type AlternativeJavaPhase = 'download' | 'extract'

const CANCELLED_ERROR_CODE = 'cancelled'
const LAUNCH_IN_PROGRESS_ERROR_CODE = 'launch_in_progress'

export function useAlternativeJava() {
  const notification = useNotificationStore()
  const { sendSystemNotification } = useSystemNotifications()
  const distributions = ref<JavaDistribution[]>([])
  const selectedDistribution = ref<string>('')
  const javaVersion = ref<string>('')
  const replaceDefault = ref<boolean>(false)
  const isDownloading = ref<boolean>(false)
  const isPopupOpen = ref<boolean>(false)
  const isDistributionsLoading = ref<boolean>(false)
  const distributionsError = ref<string>('')
  const versionError = ref<string>('')
  const downloaded = ref<number>(0)
  const total = ref<number>(0)
  const phase = ref<AlternativeJavaPhase>('download')
  const downloadRequested = ref<boolean>(false)

  const versionGuard = useAsyncRaceGuard()
  const distributionsGuard = useAsyncRaceGuard()

  const loadJavaVersion = async (mcVersion: string): Promise<void> => {
    const generation = versionGuard.next()
    versionError.value = ''
    try {
      const version = await getJavaVersion(mcVersion)
      if (!versionGuard.isCurrent(generation)) return
      javaVersion.value = version
    } catch (e: unknown) {
      if (!versionGuard.isCurrent(generation)) return
      javaVersion.value = ''
      versionError.value = getErrorMessage(e)
      reportError('Не удалось определить требуемую версию Java', e)
    }
  }

  const loadDistributions = async (): Promise<void> => {
    const generation = distributionsGuard.next()
    isDistributionsLoading.value = true
    distributionsError.value = ''
    try {
      const list = await getJavaDistributions()
      if (!distributionsGuard.isCurrent(generation)) return
      distributions.value = list
      if (!selectedDistribution.value) {
        const [first] = list
        if (first !== undefined) selectedDistribution.value = first.name
      }
    } catch (e: unknown) {
      if (!distributionsGuard.isCurrent(generation)) return
      distributionsError.value = getErrorMessage(e)
      reportError('Не удалось загрузить список Java-дистрибутивов', e)
    } finally {
      if (distributionsGuard.isCurrent(generation)) isDistributionsLoading.value = false
    }
  }

  const openPopup = async (mcVersion: string): Promise<void> => {
    isPopupOpen.value = true
    await Promise.all([
      distributions.value.length === 0 ? loadDistributions() : Promise.resolve(),
      loadJavaVersion(mcVersion),
    ])
  }

  const resetDownloadProgress = (): void => {
    downloaded.value = 0
    total.value = 0
    phase.value = 'download'
    downloadRequested.value = false
  }

  const cancelDownload = async (): Promise<void> => {
    if (!isDownloading.value) {
      isPopupOpen.value = false
      return
    }
    downloadRequested.value = true
    try {
      await cancelAlternativeJava()
    } catch (e: unknown) {
      reportError('Не удалось отменить загрузку Java', e)
    }
  }

  const closePopup = (): void => {
    if (isDownloading.value) {
      void cancelDownload()
      return
    }
    isPopupOpen.value = false
  }

  const startDownload = async (): Promise<AlternativeJavaDownloadResult> => {
    if (isDownloading.value) return 'busy'
    const dist = distributions.value.find((d) => d.name === selectedDistribution.value)
    if (!dist) {
      notification.show('Выберите дистрибутив Java')
      return 'unavailable'
    }

    isDownloading.value = true
    resetDownloadProgress()
    let unlistenSteps: UnlistenFn | null = null
    try {
      unlistenSteps = await listenJavaDownloadSteps((event: StepEvent) => {
        if (event.id !== STEP_IDS.javaAltDownload && event.id !== STEP_IDS.javaAltExtract) return
        if (event.type === 'progress') {
          downloaded.value = event.current
          total.value = event.total
          return
        }
        if (event.type === 'started' && event.id === STEP_IDS.javaAltExtract) phase.value = 'extract'
      })
      await downloadAlternativeJava(
        dist.apiParameter,
        javaVersion.value || null,
        replaceDefault.value
      )
      void sendSystemNotification('Java установлена', `Дистрибутив ${dist.name} готов к использованию`)
      isPopupOpen.value = false
      return replaceDefault.value ? 'replaced' : 'downloaded'
    } catch (e: unknown) {
      const { code, message } = getCommandError(e)
      if (code === CANCELLED_ERROR_CODE) {
        isPopupOpen.value = false
        return 'failed'
      }
      if (code === LAUNCH_IN_PROGRESS_ERROR_CODE) {
        return 'busy'
      }
      reportError('Не удалось скачать Java', e)
      notification.show(`Ошибка загрузки Java: ${message}`)
      return 'failed'
    } finally {
      unlistenSteps?.()
      isDownloading.value = false
      resetDownloadProgress()
    }
  }

  return {
    distributions,
    selectedDistribution,
    javaVersion,
    replaceDefault,
    isDownloading,
    isPopupOpen,
    isDistributionsLoading,
    distributionsError,
    versionError,
    downloaded,
    total,
    phase,
    downloadRequested,
    openPopup,
    closePopup,
    cancelDownload,
    startDownload,
  }
}
