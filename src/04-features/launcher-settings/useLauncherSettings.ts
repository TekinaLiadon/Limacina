import { ref, onMounted } from 'vue'
import { useCoreStore } from '@/05-entities'
import { saveLauncherSettings, saveLauncherConfig } from '@/06-shared/api'
import type { LauncherSettingsPayload } from '@/06-shared/api'
import { open } from '@tauri-apps/plugin-dialog'

export function useLauncherSettings() {
  const coreStore = useCoreStore()
  const isSaving = ref<boolean>(false)
  const showNotification = ref<boolean>(false)
  const launcherPath = ref<string>('')

  const settings = ref<LauncherSettingsPayload>({
    discordActivity: false,
    keepOldConfigs: false,
    downloadSpeedLimit: null,
    autoUpdate: true,
    systemNotifications: false,
    debugMode: false,
    startWithSystem: false,
    closeAfterLaunch: false,
  })

  const loadSettings = (): void => {
    const config = coreStore.launcherConfig
    if (!config) return

    launcherPath.value = config.launcherPath
    settings.value = {
      discordActivity: config.discordActivity,
      keepOldConfigs: config.keepOldConfigs,
      downloadSpeedLimit: config.downloadSpeedLimit,
      autoUpdate: config.autoUpdate,
      systemNotifications: config.systemNotifications,
      debugMode: config.debugMode,
      startWithSystem: config.startWithSystem,
      closeAfterLaunch: config.closeAfterLaunch,
    }
  }

  onMounted((): void => {
    loadSettings()
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
      showNotification.value = true
    } catch (e: unknown) {
      console.error(e)
    } finally {
      isSaving.value = false
    }
  }

  return {
    launcherPath,
    settings,
    isSaving,
    showNotification,
    selectLauncherFolder,
    handleSave,
  }
}
