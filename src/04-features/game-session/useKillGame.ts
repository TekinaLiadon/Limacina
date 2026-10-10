import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useLaunchStore, useNotificationStore } from '@/05-entities'
import { getErrorMessage, killGameProcess } from '@/06-shared/api'

export function useKillGame(): {
  isGameRunning: ComputedRef<boolean>
  isKilling: Ref<boolean>
  killGame: () => Promise<void>
} {
  const launchStore = useLaunchStore()
  const notificationStore = useNotificationStore()
  const isKilling = ref<boolean>(false)

  const isGameRunning = computed((): boolean => launchStore.gameUsername !== null)

  const killGame = async (): Promise<void> => {
    if (isKilling.value) return
    if (!isGameRunning.value) {
      notificationStore.show('Игра не запущена')
      return
    }
    isKilling.value = true
    try {
      await killGameProcess()
    } catch (e: unknown) {
      notificationStore.show(`Не удалось завершить процесс игры: ${getErrorMessage(e)}`)
    } finally {
      isKilling.value = false
    }
  }

  return { isGameRunning, isKilling, killGame }
}
