import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, type UpdateVersionInfo } from '@/05-entities'
import { applyUpdateCmd, getErrorMessage, getLauncherVersions } from '@/06-shared/api'

export function useLauncherUpdate(): {
  versions: Ref<UpdateVersionInfo[]>
  selectedVersion: Ref<string>
  currentVersion: ComputedRef<string>
  isLoading: Ref<boolean>
  isApplying: Ref<boolean>
  isApplyDisabled: ComputedRef<boolean>
  selectVersion: (version: string) => void
  handleApplyVersion: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const versions = ref<UpdateVersionInfo[]>([])
  const selectedVersion = ref<string>('')
  const isLoading = ref<boolean>(false)
  const isApplying = ref<boolean>(false)

  const currentVersion = computed((): string => coreStore.version)

  const isApplyDisabled = computed((): boolean => {
    return (
      isLoading.value ||
      isApplying.value ||
      !selectedVersion.value ||
      selectedVersion.value === currentVersion.value
    )
  })

  const loadVersions = async (): Promise<void> => {
    isLoading.value = true
    try {
      versions.value = await getLauncherVersions()
      selectedVersion.value = currentVersion.value
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isLoading.value = false
    }
  }

  onMounted((): void => {
    void loadVersions()
  })

  const selectVersion = (version: string): void => {
    selectedVersion.value = version
  }

  const handleApplyVersion = async (): Promise<void> => {
    const target = selectedVersion.value
    if (!target || target === currentVersion.value || isApplying.value) return

    const confirmed = await notification.confirm(
      `Откатить лаунчер на версию v${target}? Лаунчер перезапустится.`
    )
    if (!confirmed) return

    isApplying.value = true
    try {
      await applyUpdateCmd(target)
      notification.show(`Установлена версия v${target}, лаунчер перезапускается...`)
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isApplying.value = false
    }
  }

  return {
    versions,
    selectedVersion,
    currentVersion,
    isLoading,
    isApplying,
    isApplyDisabled,
    selectVersion,
    handleApplyVersion,
  }
}
