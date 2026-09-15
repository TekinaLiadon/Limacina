import { ref } from 'vue'
import { downloadAlternativeJava, getErrorMessage, getJavaDistributions, getJavaVersion } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { useNotificationStore } from '@/05-entities'
import { useSystemNotifications } from '@/04-features/system-notifications/useSystemNotifications'
import type { JavaDistribution } from '@/05-entities/core/types'

export function useAlternativeJava() {
  const notification = useNotificationStore()
  const { sendSystemNotification } = useSystemNotifications()
  const distributions = ref<JavaDistribution[]>([])
  const selectedDistribution = ref<string>('')
  const javaVersion = ref<string>('')
  const replaceDefault = ref<boolean>(false)
  const isDownloading = ref<boolean>(false)
  const isPopupOpen = ref<boolean>(false)

  const loadJavaVersion = async (mcVersion: string): Promise<void> => {
    try {
      javaVersion.value = await getJavaVersion(mcVersion)
    } catch (e: unknown) {
      reportError('Не удалось определить требуемую версию Java', e)
    }
  }

  const loadDistributions = async (): Promise<void> => {
    try {
      distributions.value = await getJavaDistributions()
      if (!selectedDistribution.value) {
        const [first] = distributions.value
        if (first !== undefined) selectedDistribution.value = first.name
      }
    } catch (e: unknown) {
      reportError('Не удалось загрузить список Java-дистрибутивов', e)
    }
  }

  const openPopup = async (mcVersion: string): Promise<void> => {
    if (distributions.value.length === 0) {
      await loadDistributions()
    }

    await loadJavaVersion(mcVersion)
    isPopupOpen.value = true
  }

  const closePopup = (): void => {
    if (!isDownloading.value) isPopupOpen.value = false
  }

  const startDownload = async (): Promise<boolean> => {
    const dist = distributions.value.find((d) => d.name === selectedDistribution.value)
    if (!dist) return false

    isDownloading.value = true
    try {
      await downloadAlternativeJava(
        dist.apiParameter,
        javaVersion.value || null,
        replaceDefault.value
      )
      void sendSystemNotification('Java установлена', `Дистрибутив ${dist.name} готов к использованию`)
      isPopupOpen.value = false
      return replaceDefault.value
    } catch (e: unknown) {
      const message = getErrorMessage(e)
      notification.show(`Ошибка загрузки Java: ${message}`)
      return false
    } finally {
      isDownloading.value = false
    }
  }

  return {
    distributions,
    selectedDistribution,
    javaVersion,
    replaceDefault,
    isDownloading,
    isPopupOpen,
    openPopup,
    closePopup,
    startDownload,
  }
}
