import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, bindSettingsDirtyTab, type LauncherConfig, type LauncherSettingsPayload } from '@/05-entities'
import { getErrorMessage, saveLauncherSettings, saveLauncherConfig, getAppInitData } from '@/06-shared/api'
import {
  joinPath,
  stripPathSuffix,
  reportError,
  selectDirectory,
  isAutostartEnabled,
  enableAutostart,
  disableAutostart,
  useDirtySnapshot,
  useAsyncAction,
} from '@/06-shared'

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
  downloadSpeedLimitError: ComputedRef<string>
  isLoading: Ref<boolean>
  loadError: Ref<string>
  isSaving: Ref<boolean>
  isDirty: ComputedRef<boolean>
  selectLauncherFolder: () => Promise<void>
  handleSave: () => Promise<void>
  retryLoad: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const isSaving = ref<boolean>(false)
  interface DirtySnapshot extends LauncherSettingsPayload {
    launcherPath: string
  }

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
  const isLoading = ref<boolean>(false)
  const loadError = ref<string>('')
  let loadGeneration = 0

  const parseSpeedLimit = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const parsed = Number.parseInt(trimmed, 10)
    return parsed > 0 ? parsed : null
  }

  const downloadSpeedLimitError = computed((): string => {
    const trimmed = downloadSpeedLimitInput.value.trim()
    if (trimmed === '') return ''
    if (!/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) <= 0) {
      return 'Ограничение скорости — целое число больше нуля, КБ/с'
    }
    return ''
  })

  const formSettings = (): LauncherSettingsPayload => ({
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

  const settings = computed<LauncherSettingsPayload>(formSettings)

  const dirtyState = useDirtySnapshot((): DirtySnapshot => ({
    launcherPath: launcherPath.value,
    ...formSettings(),
  }))
  const { isDirty } = dirtyState

  bindSettingsDirtyTab('launcher', isDirty)

  const syncStartWithSystemState = async (initial: boolean): Promise<boolean> => {
    try {
      const enabled = await isAutostartEnabled()
      if (startWithSystem.value !== initial) return false
      if (startWithSystem.value === enabled) return false
      startWithSystem.value = enabled
      return true
    } catch (e: unknown) {
      reportError('Не удалось получить состояние автозапуска', e)
      return false
    }
  }

  const applyStartWithSystem = async (enabled: boolean): Promise<boolean> => {
    try {
      if ((await isAutostartEnabled()) === enabled) return true
      if (enabled) {
        await enableAutostart()
      } else {
        await disableAutostart()
      }
      return true
    } catch (e: unknown) {
      notification.show(`Не удалось ${enabled ? 'включить' : 'выключить'} автозапуск: ${getErrorMessage(e)}`)
      return false
    }
  }

  const applyConfig = (config: LauncherConfig): void => {
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

  const finishLoad = (): void => {
    dirtyState.captureBaseline()
    void syncStartWithSystemState(startWithSystem.value).then((changed: boolean): void => {
      if (changed) dirtyState.patchBaseline({ startWithSystem: startWithSystem.value })
    })
  }

  const loadConfig = async (force: boolean = false): Promise<void> => {
    const existing = coreStore.launcherConfig
    if (!force && existing) {
      applyConfig(existing)
      finishLoad()
      return
    }

    const generation = ++loadGeneration
    isLoading.value = true
    loadError.value = ''
    dirtyState.clearBaseline()
    try {
      const data = await getAppInitData()
      if (generation !== loadGeneration) return
      const config = data.launcherConfig
      if (!config) {
        loadError.value = 'Не удалось загрузить настройки лаунчера'
        return
      }
      coreStore.launcherConfig = config
      applyConfig(config)
      finishLoad()
    } catch (e: unknown) {
      if (generation !== loadGeneration) return
      reportError('Не удалось загрузить настройки лаунчера', e)
      loadError.value = getErrorMessage(e)
    } finally {
      if (generation === loadGeneration) isLoading.value = false
    }
  }

  const retryLoad = (): Promise<void> => loadConfig(true)

  onMounted((): void => {
    void loadConfig()
  })

  const selectLauncherFolder = async (): Promise<void> => {
    const selected = await selectDirectory()
    if (selected) {
      launcherPath.value = joinPath(selected, coreStore.launcherName)
    }
  }

  const resyncLauncherConfig = async (): Promise<void> => {
    try {
      const data = await getAppInitData()
      coreStore.launcherConfig = data.launcherConfig
    } catch (e: unknown) {
      reportError('Не удалось восстановить состояние настроек', e)
    }
  }

  const saveAction = useAsyncAction(async (e: unknown): Promise<void> => {
    await resyncLauncherConfig()
    notification.show(getErrorMessage(e))
  }, isSaving)

  const handleSave = async (): Promise<void> => {
    if (isSaving.value) return
    if (isLoading.value || loadError.value) return
    if (downloadSpeedLimitError.value) {
      notification.show(downloadSpeedLimitError.value)
      return
    }
    await saveAction.run(async () => {
      const savedSettings = await saveLauncherSettings(settings.value)
      coreStore.launcherConfig = savedSettings

      const config = coreStore.launcherConfig
      if (config && launcherPath.value !== config.launcherPath) {
        const parentPath = stripPathSuffix(launcherPath.value, coreStore.launcherName)
        coreStore.launcherConfig = await saveLauncherConfig(parentPath)
      }

      dirtyState.captureBaseline()

      if (!(await applyStartWithSystem(startWithSystem.value))) return
      notification.show('Настройки сохранены')
    })
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
    downloadSpeedLimitError,
    isLoading,
    loadError,
    isSaving,
    isDirty,
    selectLauncherFolder,
    handleSave,
    retryLoad,
  }
}
