import { computed, onMounted, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import {
  useCoreStore,
  useNotificationStore,
  bindSettingsDirtyTab,
  type LauncherBehaviorForm,
  type LauncherConfig,
  type LauncherSettingsPayload,
} from '@/05-entities'
import { getErrorMessage, saveLauncherSettings, saveLauncherConfig, getAppInitData } from '@/06-shared/api'
import {
  joinPath,
  stripPathSuffix,
  reportError,
  selectDirectory,
  isAutostartEnabled,
  enableAutostart,
  disableAutostart,
  useAsyncRaceGuard,
  useDirtySnapshot,
  useAsyncAction,
} from '@/06-shared'

type LauncherFormField = keyof LauncherBehaviorForm

type LauncherFieldTransfers = {
  [K in LauncherFormField]: {
    default: LauncherBehaviorForm[K]
    fromConfig: (raw: LauncherConfig[K]) => LauncherBehaviorForm[K]
    toPayload: (value: LauncherBehaviorForm[K]) => LauncherSettingsPayload[K]
  }
}

type FieldTransfer<T> = {
  default: T
  fromConfig: (raw: T) => T
  toPayload: (value: T) => T
}

const identityTransfer = <T>(defaultValue: T): FieldTransfer<T> => ({
  default: defaultValue,
  fromConfig: (raw) => raw,
  toPayload: (value) => value,
})

const parseSpeedLimit = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 10)
  return parsed > 0 ? parsed : null
}

const LAUNCHER_FIELD_TRANSFERS: LauncherFieldTransfers = {
  discordActivity: identityTransfer(true),
  autoUpdate: identityTransfer(false),
  keepOldConfigs: identityTransfer(false),
  startWithSystem: identityTransfer(false),
  closeAfterLaunch: identityTransfer(false),
  minimizeToTray: identityTransfer(false),
  systemNotifications: identityTransfer(true),
  debugMode: identityTransfer(false),
  downloadSpeedLimit: {
    default: '',
    fromConfig: (raw) => (raw === null ? '' : String(raw)),
    toPayload: (value) => parseSpeedLimit(value),
  },
}

const launcherFormFieldKeys = (): LauncherFormField[] =>
  Object.keys(LAUNCHER_FIELD_TRANSFERS) as LauncherFormField[]

const writeFormFieldFromConfig = <K extends LauncherFormField>(
  form: LauncherBehaviorForm,
  key: K,
  config: LauncherConfig,
): void => {
  form[key] = LAUNCHER_FIELD_TRANSFERS[key].fromConfig(config[key])
}

const writeDefaultFormField = <K extends LauncherFormField>(form: LauncherBehaviorForm, key: K): void => {
  form[key] = LAUNCHER_FIELD_TRANSFERS[key].default
}

const writePayloadFieldFromForm = <K extends LauncherFormField>(
  payload: LauncherSettingsPayload,
  key: K,
  form: LauncherBehaviorForm,
): void => {
  payload[key] = LAUNCHER_FIELD_TRANSFERS[key].toPayload(form[key])
}

const createDefaultForm = (): LauncherBehaviorForm => {
  const form = {} as LauncherBehaviorForm
  for (const key of launcherFormFieldKeys()) {
    writeDefaultFormField(form, key)
  }
  return form
}

const formSettingsOf = (form: LauncherBehaviorForm): LauncherSettingsPayload => {
  const payload = {} as LauncherSettingsPayload
  for (const key of launcherFormFieldKeys()) {
    writePayloadFieldFromForm(payload, key, form)
  }
  return payload
}

export function useLauncherSettings(): {
  behaviorForm: Ref<LauncherBehaviorForm>
  launcherPath: Ref<string>
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
  const behaviorForm = ref<LauncherBehaviorForm>(createDefaultForm())
  const isLoading = ref<boolean>(false)
  const loadError = ref<string>('')
  const loadGuard = useAsyncRaceGuard()

  const downloadSpeedLimitError = computed((): string => {
    const trimmed = behaviorForm.value.downloadSpeedLimit.trim()
    if (trimmed === '') return ''
    if (!/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) <= 0) {
      return 'Ограничение скорости — целое число больше нуля, КБ/с'
    }
    return ''
  })

  const formSettings = (): LauncherSettingsPayload => formSettingsOf(behaviorForm.value)

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
      const current = behaviorForm.value.startWithSystem
      if (current !== initial) return false
      if (current === enabled) return false
      behaviorForm.value.startWithSystem = enabled
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
    const form = behaviorForm.value
    for (const key of launcherFormFieldKeys()) {
      writeFormFieldFromConfig(form, key, config)
    }
  }

  const finishLoad = (): void => {
    dirtyState.captureBaseline()
    void syncStartWithSystemState(behaviorForm.value.startWithSystem).then((changed: boolean): void => {
      if (changed) dirtyState.patchBaseline({ startWithSystem: behaviorForm.value.startWithSystem })
    })
  }

  const loadConfig = async (force: boolean = false): Promise<void> => {
    const existing = coreStore.launcherConfig
    if (!force && existing) {
      applyConfig(existing)
      finishLoad()
      return
    }

    const generation = loadGuard.next()
    isLoading.value = true
    loadError.value = ''
    dirtyState.clearBaseline()
    try {
      const data = await getAppInitData()
      if (!loadGuard.isCurrent(generation)) return
      const config = data.launcherConfig
      if (!config) {
        loadError.value = 'Не удалось загрузить настройки лаунчера'
        return
      }
      coreStore.launcherConfig = config
      applyConfig(config)
      finishLoad()
    } catch (e: unknown) {
      if (!loadGuard.isCurrent(generation)) return
      reportError('Не удалось загрузить настройки лаунчера', e)
      loadError.value = getErrorMessage(e)
    } finally {
      if (loadGuard.isCurrent(generation)) isLoading.value = false
    }
  }

  const retryLoad = (): Promise<void> => loadConfig(true)

  onMounted((): void => {
    void loadConfig()
  })

  onScopeDispose((): void => loadGuard.cancel())

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

      if (!(await applyStartWithSystem(behaviorForm.value.startWithSystem))) return
      notification.show('Настройки сохранены')
    })
  }

  return {
    behaviorForm,
    launcherPath,
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
