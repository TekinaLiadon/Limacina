import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, type LauncherConfig, type LauncherSettingsPayload } from '@/05-entities'
import { getErrorMessage, saveLauncherSettings, saveLauncherConfig, getAppInitData } from '@/06-shared/api'
import { joinPath, stripPathSuffix, reportError } from '@/06-shared'
import { open } from '@tauri-apps/plugin-dialog'
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart'

export function useLauncherSettings(): {
  launcherPath: Ref<string>
  discordActivity: Ref<boolean>
  autoUpdate: Ref<boolean>
  keepOldConfigs: Ref<boolean>
  startWithSystem: Ref<boolean>
  closeAfterLaunch: Ref<boolean>
  minimizeToTray: Ref<boolean>
  systemNotifications: Ref<boolean>
  debugMode: Ref<boolean>
  downloadSpeedLimitInput: Ref<string>
  settings: ComputedRef<LauncherSettingsPayload>
  isSaving: Ref<boolean>
  isDirty: Ref<boolean>
  selectLauncherFolder: () => Promise<void>
  handleSave: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const isSaving = ref<boolean>(false)
  const isDirty = ref<boolean>(false)
  const launcherPath = ref<string>('')
  const discordActivity = ref<boolean>(true)
  const autoUpdate = ref<boolean>(false)
  const keepOldConfigs = ref<boolean>(false)
  const startWithSystem = ref<boolean>(false)
  const closeAfterLaunch = ref<boolean>(false)
  const minimizeToTray = ref<boolean>(false)
  const systemNotifications = ref<boolean>(true)
  const debugMode = ref<boolean>(false)
  const downloadSpeedLimitInput = ref<string>('')

  const parseSpeedLimit = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  const savedPayload = (config: LauncherConfig | null): LauncherSettingsPayload => ({
    discordActivity: config?.discordActivity ?? true,
    keepOldConfigs: config?.keepOldConfigs ?? false,
    downloadSpeedLimit: config?.downloadSpeedLimit ?? null,
    autoUpdate: config?.autoUpdate ?? false,
    systemNotifications: config?.systemNotifications ?? true,
    debugMode: config?.debugMode ?? false,
    startWithSystem: config?.startWithSystem ?? false,
    closeAfterLaunch: config?.closeAfterLaunch ?? false,
    minimizeToTray: config?.minimizeToTray ?? false,
  })

  const settings = computed<LauncherSettingsPayload>(() => ({
    ...savedPayload(coreStore.launcherConfig),
    discordActivity: discordActivity.value,
    autoUpdate: autoUpdate.value,
    keepOldConfigs: keepOldConfigs.value,
    startWithSystem: startWithSystem.value,
    closeAfterLaunch: closeAfterLaunch.value,
    minimizeToTray: minimizeToTray.value,
    systemNotifications: systemNotifications.value,
    debugMode: debugMode.value,
    downloadSpeedLimit: parseSpeedLimit(downloadSpeedLimitInput.value),
  }))

  const syncStartWithSystemState = async (): Promise<void> => {
    try {
      startWithSystem.value = await isAutostartEnabled()
    } catch (e: unknown) {
      reportError('Не удалось получить состояние автозапуска', e)
    }
  }

  const applyStartWithSystem = async (enabled: boolean): Promise<void> => {
    try {
      if ((await isAutostartEnabled()) === enabled) return
      if (enabled) {
        await enableAutostart()
      } else {
        await disableAutostart()
      }
    } catch (e: unknown) {
      notification.show(`Не удалось ${enabled ? 'включить' : 'выключить'} автозапуск: ${getErrorMessage(e)}`)
    }
  }

  interface DirtySnapshot {
    launcherPath: string
    discordActivity: boolean
    autoUpdate: boolean
    keepOldConfigs: boolean
    startWithSystem: boolean
    closeAfterLaunch: boolean
    minimizeToTray: boolean
    systemNotifications: boolean
    debugMode: boolean
    downloadSpeedLimit: number | null
  }

  const snapshot = (): DirtySnapshot => ({
    launcherPath: launcherPath.value,
    discordActivity: discordActivity.value,
    autoUpdate: autoUpdate.value,
    keepOldConfigs: keepOldConfigs.value,
    startWithSystem: startWithSystem.value,
    closeAfterLaunch: closeAfterLaunch.value,
    minimizeToTray: minimizeToTray.value,
    systemNotifications: systemNotifications.value,
    debugMode: debugMode.value,
    downloadSpeedLimit: parseSpeedLimit(downloadSpeedLimitInput.value),
  })

  const initialSnapshot = ref<DirtySnapshot | null>(null)

  const refreshDirty = (): void => {
    const initial = initialSnapshot.value
    isDirty.value = initial !== null && JSON.stringify(initial) !== JSON.stringify(snapshot())
  }

  onMounted((): void => {
    const config = coreStore.launcherConfig
    if (config) {
      launcherPath.value = config.launcherPath
      discordActivity.value = config.discordActivity
      autoUpdate.value = config.autoUpdate
      keepOldConfigs.value = config.keepOldConfigs
      startWithSystem.value = config.startWithSystem
      closeAfterLaunch.value = config.closeAfterLaunch
      minimizeToTray.value = config.minimizeToTray
      systemNotifications.value = config.systemNotifications
      debugMode.value = config.debugMode
      downloadSpeedLimitInput.value =
        config.downloadSpeedLimit != null ? String(config.downloadSpeedLimit) : ''
    }
    void syncStartWithSystemState().then((): void => {
      initialSnapshot.value = snapshot()
      refreshDirty()
    })
  })

  const selectLauncherFolder = async (): Promise<void> => {
    const selected = await open({ directory: true })
    if (selected) {
      launcherPath.value = joinPath(selected, coreStore.launcherName)
    }
  }

  const resyncLauncherConfig = async (): Promise<void> => {
    try {
      const data = await getAppInitData()
      coreStore.launcherConfig = data.launcherConfig
      coreStore.hasLauncherConfig = data.launcherConfig !== null
    } catch (e: unknown) {
      reportError('Не удалось восстановить состояние настроек', e)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (isSaving.value) return
    isSaving.value = true
    try {
      const savedSettings = await saveLauncherSettings(settings.value)
      coreStore.launcherConfig = savedSettings

      const config = coreStore.launcherConfig
      if (config && launcherPath.value !== config.launcherPath) {
        const parentPath = stripPathSuffix(launcherPath.value, coreStore.launcherName)
        coreStore.launcherConfig = await saveLauncherConfig(parentPath)
      }

      await applyStartWithSystem(startWithSystem.value)
      initialSnapshot.value = snapshot()
      refreshDirty()
      notification.show('Настройки сохранены')
    } catch (e: unknown) {
      await resyncLauncherConfig()
      notification.show(getErrorMessage(e))
    } finally {
      isSaving.value = false
    }
  }

  return {
    launcherPath,
    discordActivity,
    autoUpdate,
    keepOldConfigs,
    startWithSystem,
    closeAfterLaunch,
    minimizeToTray,
    systemNotifications,
    debugMode,
    downloadSpeedLimitInput,
    settings,
    isSaving,
    isDirty,
    selectLauncherFolder,
    handleSave,
  }
}
