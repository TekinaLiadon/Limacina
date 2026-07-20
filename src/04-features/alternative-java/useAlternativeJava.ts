import { ref } from 'vue'
import { getJavaDistributions, downloadAlternativeJava } from '@/06-shared/api'
import { useNotificationStore } from '@/05-entities'
import type { JavaDistribution } from '@/05-entities/core/types'

export function useAlternativeJava() {
  const notification = useNotificationStore()
  const distributions = ref<JavaDistribution[]>([])
  const selectedDistribution = ref<string>('')
  const javaVersion = ref<string>('')
  const replaceDefault = ref<boolean>(false)
  const isDownloading = ref<boolean>(false)
  const isPopupOpen = ref<boolean>(false)

  const getJavaVersionForMc = (mcVersion: string): string => {
    const parts = mcVersion.split('.').map(Number)
    const major = parts[0] ?? 0
    const minor = parts[1] ?? 0
    if (major > 1 || (major === 1 && minor >= 21)) return '21'
    if (major === 1 && minor >= 17) return '17'
    return '8'
  }

  const loadDistributions = async (): Promise<void> => {
    try {
      distributions.value = await getJavaDistributions()
      if (distributions.value.length > 0 && !selectedDistribution.value) {
        selectedDistribution.value = distributions.value[0].name
      }
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const openPopup = async (mcVersion: string): Promise<void> => {
    if (distributions.value.length === 0) {
      await loadDistributions()
    }

    javaVersion.value = getJavaVersionForMc(mcVersion)
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
      isPopupOpen.value = false
      return replaceDefault.value
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
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
