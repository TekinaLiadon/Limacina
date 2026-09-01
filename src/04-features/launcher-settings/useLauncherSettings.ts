import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { saveLauncherSettings, saveLauncherConfig } from '@/06-shared/api'
import type { LauncherSettingsPayload } from '@/06-shared/api'
import { open } from '@tauri-apps/plugin-dialog'

export function useLauncherSettings(): {
  launcherPath: Ref<string>
  settings: ComputedRef<LauncherSettingsPayload>
  isSaving: Ref<boolean>
  selectLauncherFolder: () => Promise<void>
  handleSave: () => Promise<void>
  setAutoUpdate: (value: boolean) => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const isSaving = ref<boolean>(false)
  const launcherPath = ref<string>('')

  const settings = computed<LauncherSettingsPayload>(() => {
    const config = coreStore.launcherConfig
    return {
      discordActivity: config?.discordActivity ?? false,
      keepOldConfigs: config?.keepOldConfigs ?? false,
      downloadSpeedLimit: config?.downloadSpeedLimit ?? null,
      autoUpdate: config?.autoUpdate ?? true,
      systemNotifications: config?.systemNotifications ?? false,
      debugMode: config?.debugMode ?? false,
      startWithSystem: config?.startWithSystem ?? false,
      closeAfterLaunch: config?.closeAfterLaunch ?? false,
    }
  })

  onMounted((): void => {
    if (coreStore.launcherConfig) {
      launcherPath.value = coreStore.launcherConfig.launcherPath
    }
  })

  const selectLauncherFolder = async (): Promise<void> => {
    const selected = await open({ directory: true })
    if (selected) {
      const parentPath = selected
      launcherPath.value = `${parentPath}/${coreStore.launcherName}`
    }
  }

  const handleSave = async (): Promise<void> => {
    isSaving.value = true
    try {
      const config = coreStore.launcherConfig
      if (config && launcherPath.value !== config.launcherPath) {
        const parentPath = launcherPath.value.replace(`/${coreStore.launcherName}$`, '')
        await saveLauncherConfig(parentPath)
      }

      const updated = await saveLauncherSettings(settings.value)
      coreStore.launcherConfig = updated
      notification.show('Настройки сохранены')
    } catch (e: unknown) {
      notification.show(String(e))
    } finally {
      isSaving.value = false
    }
  }

  const setAutoUpdate = async (value: boolean): Promise<void> => {
    try {
      const updated = await saveLauncherSettings({ ...settings.value, autoUpdate: value })
      coreStore.launcherConfig = updated
      notification.show(value ? 'Автообновление включено' : 'Автообновление отключено')
    } catch (e: unknown) {
      notification.show(String(e))
    }
  }

  return {
    launcherPath,
    settings,
    isSaving,
    selectLauncherFolder,
    handleSave,
    setAutoUpdate,
  }
}
