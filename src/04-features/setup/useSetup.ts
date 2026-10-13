import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { getErrorMessage, initializeLauncher } from '@/06-shared/api'
import { joinPath, prefersReducedMotion, reportError, selectDirectory, useAsyncAction } from '@/06-shared'
import { useAnimationSettings } from '@/04-features/animation-settings/useAnimationSettings'

export function useSetup(): {
  selectedPath: Ref<string>
  isLoading: Ref<boolean>
  fullDisplayPath: ComputedRef<string>
  selectFolder: () => Promise<void>
  save: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notificationStore = useNotificationStore()
  const { setAnimationsEnabled } = useAnimationSettings()
  const { defaultParentPath, launcherName } = storeToRefs(coreStore)

  const selectedPath = ref<string>('')
  const isLoading = ref<boolean>(false)

  watch(defaultParentPath, (val: string | null) => {
    if (val) selectedPath.value = val
  }, { immediate: true })

  const fullDisplayPath = computed((): string => {
    if (!selectedPath.value || !launcherName.value) return ''
    return joinPath(selectedPath.value, launcherName.value)
  })

  const selectFolder = async (): Promise<void> => {
    const selected = await selectDirectory()
    if (selected) selectedPath.value = selected
  }

  const saveAction = useAsyncAction((e: unknown): void => {
    reportError('Не удалось инициализировать лаунчер', e)
    notificationStore.show(getErrorMessage(e))
  }, isLoading)

  const save = async (): Promise<void> => {
    await saveAction.run(async () => {
      const config = await initializeLauncher(selectedPath.value)
      coreStore.setLauncherConfig(config)
      if (prefersReducedMotion()) {
        await setAnimationsEnabled(false)
      }
    })
  }

  return {
    selectedPath,
    isLoading,
    fullDisplayPath,
    selectFolder,
    save,
  }
}
