import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { getErrorMessage, killGameProcess } from '@/06-shared/api'

export function useKillGame(): {
  isGameRunning: ComputedRef<boolean>
  isKilling: Ref<boolean>
  killGame: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notificationStore = useNotificationStore()
  const isKilling = ref<boolean>(false)

  const isGameRunning = computed((): boolean => coreStore.gameUsername !== null)

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
