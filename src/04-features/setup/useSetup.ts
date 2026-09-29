import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { getErrorMessage, initializeLauncher } from '@/06-shared/api'
import { joinPath, prefersReducedMotion, selectDirectory } from '@/06-shared'
import { useAnimationSettings } from '@/04-features/animation-settings/useAnimationSettings'

export function useSetup(): {
  selectedPath: Ref<string>
  isLoading: Ref<boolean>
  step: Ref<1 | 2>
  needsProfile: ComputedRef<boolean>
  fullDisplayPath: ComputedRef<string>
  selectFolder: () => Promise<void>
  save: () => Promise<void>
} {
  const router = useRouter()
  const coreStore = useCoreStore()
  const notificationStore = useNotificationStore()
  const { setAnimationsEnabled } = useAnimationSettings()
  const { defaultParentPath, launcherName } = storeToRefs(coreStore)

  const selectedPath = ref<string>('')
  const isLoading = ref<boolean>(false)
  const step = ref<1 | 2>(1)

  const needsProfile = computed((): boolean => coreStore.needsOfflineSetup)

  watch((): boolean => coreStore.hasLauncherConfig, (hasConfig) => {
    if (!hasConfig) {
      step.value = 1
      return
    }
    if (!needsProfile.value) {
      router.replace('/')
      return
    }
    step.value = 2
  }, { immediate: true })

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

  const save = async (): Promise<void> => {
    if (isLoading.value) return
    isLoading.value = true
    try {
      const config = await initializeLauncher(selectedPath.value)
      coreStore.applyLauncherConfig(config)
      if (prefersReducedMotion()) {
        await setAnimationsEnabled(false)
      }
      if (needsProfile.value) {
        step.value = 2
        return
      }
      router.push('/')
    } catch (e: unknown) {
      notificationStore.show(getErrorMessage(e))
    } finally {
      isLoading.value = false
    }
  }

  return {
    selectedPath,
    isLoading,
    step,
    needsProfile,
    fullDisplayPath,
    selectFolder,
    save,
  }
}
