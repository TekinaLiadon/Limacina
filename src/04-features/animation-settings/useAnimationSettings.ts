import { computed, type ComputedRef } from 'vue'

import { useSettingsStore, useNotificationStore } from '@/05-entities'
import { getErrorMessage, saveAnimationsEnabled } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useAnimationSettings(): {
  animationsEnabled: ComputedRef<boolean>
  setAnimationsEnabled: (value: boolean) => Promise<void>
  toggleAnimations: () => Promise<void>
} {
  const settingsStore = useSettingsStore()
  const notification = useNotificationStore()

  const animationsEnabled = computed((): boolean => settingsStore.animationsEnabled)

  const setAnimationsEnabled = async (value: boolean): Promise<void> => {
    settingsStore.setAnimationsEnabled(value)
    try {
      await saveAnimationsEnabled(value)
    } catch (e: unknown) {
      reportError('Не удалось сохранить настройку анимаций', e)
      notification.show(getErrorMessage(e))
    }
  }

  const toggleAnimations = async (): Promise<void> => {
    await setAnimationsEnabled(!settingsStore.animationsEnabled)
  }

  return {
    animationsEnabled,
    setAnimationsEnabled,
    toggleAnimations,
  }
}
