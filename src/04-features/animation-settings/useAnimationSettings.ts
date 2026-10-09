import { computed, ref, type ComputedRef } from 'vue'

import { useCoreStore, useNotificationStore, useSettingsStore, type LauncherConfig } from '@/05-entities'
import { getErrorMessage, saveAnimationsEnabled } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useAnimationSettings(): {
  animationsEnabled: ComputedRef<boolean>
  setAnimationsEnabled: (value: boolean) => Promise<void>
  toggleAnimations: () => Promise<void>
} {
  const settingsStore = useSettingsStore()
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const isSavingAnimations = ref<boolean>(false)

  const animationsEnabled = computed((): boolean => settingsStore.animationsEnabled)

  const setAnimationsEnabled = async (value: boolean): Promise<void> => {
    if (isSavingAnimations.value) return
    isSavingAnimations.value = true
    const previous = settingsStore.animationsEnabled
    settingsStore.setAnimationsEnabled(value)
    try {
      const config: LauncherConfig = await saveAnimationsEnabled(value)
      coreStore.launcherConfig = config
    } catch (e: unknown) {
      settingsStore.setAnimationsEnabled(previous)
      reportError('Не удалось сохранить настройку анимаций', e)
      notification.show(getErrorMessage(e))
    } finally {
      isSavingAnimations.value = false
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
