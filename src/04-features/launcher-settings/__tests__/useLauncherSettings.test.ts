import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { saveLauncherSettings, getAppInitData } from '@/06-shared/api'
import { isAutostartEnabled, enableAutostart, disableAutostart, selectDirectory } from '@/06-shared'
import { useCoreStore, useNotificationStore, useSettingsDirtyStore, type AppInitData, type LauncherBehaviorForm, type LauncherConfig, type LauncherSettingsPayload } from '@/05-entities'
import { useLauncherSettings } from '../useLauncherSettings'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  saveLauncherSettings: vi.fn(),
  saveLauncherConfig: vi.fn(),
  getAppInitData: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  isAutostartEnabled: vi.fn(),
  enableAutostart: vi.fn(),
  disableAutostart: vi.fn(),
  selectDirectory: vi.fn(),
}))

const makeLauncherConfig = (debugMode: boolean): LauncherConfig => ({
  launcherPath: '/launcher',
  installId: null,
  discordActivity: false,
  keepOldConfigs: false,
  downloadSpeedLimit: null,
  autoUpdate: true,
  systemNotifications: false,
  debugMode,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: false,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames: ['Alpha'],
  currentProject: 'Alpha',
  projects: {},
})

const makeAppInitData = (config: LauncherConfig): AppInitData => ({
  launcherName: 'Limacina',
  defaultParentPath: '/home',
  launcherConfig: config,
  version: '1.0.0',
  totalMemoryMb: 16384,
  offlineBuild: false,
  envProjectName: null,
})

describe('useLauncherSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(enableAutostart).mockReset()
    vi.mocked(disableAutostart).mockReset()
    vi.mocked(enableAutostart).mockResolvedValue(undefined)
    vi.mocked(disableAutostart).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hydrates from the store without a backend fetch when the config is already loaded', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    expect(getAppInitData).not.toHaveBeenCalled()
    expect(settings.isLoading.value).toBe(false)
    expect(settings.loadError.value).toBe('')
    expect(settings.launcherPath.value).toBe('/launcher')
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('fetches the config from the backend and shows the loading state when the store has none', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    let resolveInit: (data: AppInitData) => void = () => {}
    vi.mocked(getAppInitData).mockImplementationOnce(
      () =>
        new Promise<AppInitData>((resolve) => {
          resolveInit = resolve
        }),
    )

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())

    expect(settings.isLoading.value).toBe(true)
    expect(settings.loadError.value).toBe('')
    expect(settings.isDirty.value).toBe(false)

    resolveInit(makeAppInitData(makeLauncherConfig(true)))
    await flushPromises()

    expect(settings.isLoading.value).toBe(false)
    expect(settings.loadError.value).toBe('')
    expect(settings.behaviorForm.value.debugMode).toBe(true)
    expect(settings.launcherPath.value).toBe('/launcher')
    expect(useCoreStore().launcherConfig).toEqual(makeLauncherConfig(true))
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('drops a stale fetch when a forced reload supersedes it', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    let releaseFirst: (data: AppInitData) => void = () => {}
    vi.mocked(getAppInitData).mockImplementationOnce(
      () =>
        new Promise<AppInitData>((resolve) => {
          releaseFirst = resolve
        }),
    )
    vi.mocked(getAppInitData).mockResolvedValueOnce(makeAppInitData(makeLauncherConfig(false)))

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    expect(settings.isLoading.value).toBe(true)

    await settings.retryLoad()

    expect(settings.behaviorForm.value.debugMode).toBe(false)
    expect(settings.isLoading.value).toBe(false)

    releaseFirst(makeAppInitData(makeLauncherConfig(true)))
    await flushPromises()

    expect(settings.behaviorForm.value.debugMode).toBe(false)
    expect(useCoreStore().launcherConfig?.debugMode).toBe(false)
    expect(settings.loadError.value).toBe('')

    unmount()
  })

  it('drops the pending fetch after unmount', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    let releaseInit: (data: AppInitData) => void = () => {}
    vi.mocked(getAppInitData).mockImplementationOnce(
      () =>
        new Promise<AppInitData>((resolve) => {
          releaseInit = resolve
        }),
    )

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    expect(settings.isLoading.value).toBe(true)

    unmount()
    releaseInit(makeAppInitData(makeLauncherConfig(true)))
    await flushPromises()

    expect(settings.behaviorForm.value.debugMode).toBe(false)
    expect(useCoreStore().launcherConfig).toBeNull()
    expect(settings.loadError.value).toBe('')
  })

  it('blocks the save while the load failed and recovers through retry', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(getAppInitData).mockRejectedValueOnce(new Error('disk locked'))
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    expect(settings.loadError.value).not.toBe('')
    expect(settings.isLoading.value).toBe(false)
    expect(settings.isDirty.value).toBe(false)

    settings.launcherPath.value = '/other'
    await settings.handleSave()
    expect(saveLauncherSettings).not.toHaveBeenCalled()

    vi.mocked(getAppInitData).mockResolvedValueOnce(makeAppInitData(makeLauncherConfig(false)))
    await settings.retryLoad()
    await flushPromises()

    expect(settings.loadError.value).toBe('')
    expect(settings.launcherPath.value).toBe('/launcher')
    expect(settings.isDirty.value).toBe(false)

    await settings.handleSave()
    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('live-dirties when a field changes and cleans up when reverted', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    expect(settings.isDirty.value).toBe(false)

    settings.behaviorForm.value.debugMode = true
    expect(settings.isDirty.value).toBe(true)

    settings.behaviorForm.value.debugMode = false
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('resets dirty state after a successful save', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.behaviorForm.value.debugMode = true
    expect(settings.isDirty.value).toBe(true)

    await settings.handleSave()

    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('applies the save response without rolling back the project scope', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    const core = useCoreStore()
    core.setLauncherConfig({
      ...makeLauncherConfig(false),
      projectNames: ['Alpha', 'Beta'],
      currentProject: 'Beta',
    })
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(true))

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.behaviorForm.value.debugMode = true
    await settings.handleSave()

    expect(core.launcherConfig?.debugMode).toBe(true)
    expect(core.launcherConfig?.projectNames).toEqual(['Alpha', 'Beta'])
    expect(core.launcherConfig?.currentProject).toBe('Beta')
    expect(core.projects).toEqual(['Alpha', 'Beta'])
    expect(core.currentProject).toBe('Beta')

    unmount()
  })

  it('applies the OS autostart state on mount when the toggle is untouched', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(true)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    expect(settings.behaviorForm.value.startWithSystem).toBe(true)
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('keeps unrelated edits dirty when the mount autostart sync lands late', async () => {
    let releaseAutostart: (enabled: boolean) => void = () => {}
    vi.mocked(isAutostartEnabled).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseAutostart = resolve
        }),
    )
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())

    settings.behaviorForm.value.debugMode = true
    expect(settings.isDirty.value).toBe(true)

    releaseAutostart(true)
    await flushPromises()

    expect(settings.behaviorForm.value.startWithSystem).toBe(true)
    expect(settings.isDirty.value).toBe(true)

    settings.behaviorForm.value.debugMode = false
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('keeps the user choice when the toggle happens before the autostart sync', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())

    settings.behaviorForm.value.startWithSystem = true
    await flushPromises()

    expect(settings.behaviorForm.value.startWithSystem).toBe(true)
    expect(settings.isDirty.value).toBe(true)

    unmount()
  })

  it('drops the autostart sync when the project switches before the state resolves', async () => {
    let releaseAutostart: (enabled: boolean) => void = () => {}
    vi.mocked(isAutostartEnabled).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseAutostart = resolve
        }),
    )
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    useCoreStore().currentProject = 'other'

    releaseAutostart(true)
    await flushPromises()

    expect(settings.behaviorForm.value.startWithSystem).toBe(false)
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('applies the OS autostart before writing the settings and aborts the save when it fails', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    const core = useCoreStore()
    core.launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    const showSpy = vi.spyOn(useNotificationStore(), 'show')
    settings.behaviorForm.value.startWithSystem = true
    vi.mocked(isAutostartEnabled).mockRejectedValueOnce(new Error('autostart locked'))
    await settings.handleSave()

    expect(enableAutostart).not.toHaveBeenCalled()
    expect(saveLauncherSettings).not.toHaveBeenCalled()
    expect(core.launcherConfig?.startWithSystem).toBe(false)
    expect(settings.isDirty.value).toBe(true)
    expect(showSpy).toHaveBeenCalledWith('Не удалось включить автозапуск: autostart locked')
    expect(showSpy).not.toHaveBeenCalledWith('Настройки сохранены')

    unmount()
  })

  it('saves the other fields without touching a broken autostart plugin when the toggle is untouched', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue({
      ...makeLauncherConfig(true),
      startWithSystem: false,
    })
    const core = useCoreStore()
    core.launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    vi.mocked(isAutostartEnabled).mockClear()
    vi.mocked(isAutostartEnabled).mockRejectedValue(new Error('autostart locked'))
    settings.behaviorForm.value.debugMode = true
    await settings.handleSave()

    expect(isAutostartEnabled).not.toHaveBeenCalled()
    expect(enableAutostart).not.toHaveBeenCalled()
    expect(disableAutostart).not.toHaveBeenCalled()
    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)
    expect(core.launcherConfig?.debugMode).toBe(true)
    expect(settings.isDirty.value).toBe(false)
    expect(useNotificationStore().message).toBe('Настройки сохранены')

    unmount()
  })

  it('applies the OS autostart before the config write', async () => {
    const calls: string[] = []
    let osAutostart = false
    vi.mocked(saveLauncherSettings).mockImplementation(async () => {
      calls.push('save')
      return makeLauncherConfig(true)
    })
    vi.mocked(isAutostartEnabled).mockImplementation(async () => osAutostart)
    vi.mocked(enableAutostart).mockImplementation(async () => {
      calls.push('enable')
      osAutostart = true
    })
    const core = useCoreStore()
    core.launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.behaviorForm.value.startWithSystem = true
    await settings.handleSave()

    expect(calls).toEqual(['enable', 'save'])
    expect(osAutostart).toBe(true)
    expect(core.launcherConfig?.startWithSystem).toBe(true)
    expect(settings.isDirty.value).toBe(false)
    expect(useNotificationStore().message).toBe('Настройки сохранены')

    unmount()
  })

  it('rolls the OS autostart back when the config write fails after the OS apply', async () => {
    let osAutostart = false
    vi.mocked(isAutostartEnabled).mockImplementation(async () => osAutostart)
    vi.mocked(enableAutostart).mockImplementation(async () => {
      osAutostart = true
    })
    vi.mocked(disableAutostart).mockImplementation(async () => {
      osAutostart = false
    })
    vi.mocked(saveLauncherSettings).mockRejectedValueOnce(new Error('disk full'))
    vi.mocked(getAppInitData).mockResolvedValueOnce(makeAppInitData(makeLauncherConfig(false)))
    const core = useCoreStore()
    core.launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.behaviorForm.value.startWithSystem = true
    await settings.handleSave()

    expect(enableAutostart).toHaveBeenCalledTimes(1)
    expect(disableAutostart).toHaveBeenCalledTimes(1)
    expect(osAutostart).toBe(false)
    expect(core.launcherConfig?.startWithSystem).toBe(false)
    expect(settings.isDirty.value).toBe(true)
    expect(useNotificationStore().message).toBe('disk full')

    unmount()
  })

  it('patches only the saved fields and keeps newer fields from another save', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    const core = useCoreStore()
    core.launcherConfig = makeLauncherConfig(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue({
      ...makeLauncherConfig(false),
      theme: 'stale-theme',
      animationsEnabled: false,
      debugMode: true,
    })

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    core.patchLauncherConfig({ theme: 'lime-dark', animationsEnabled: true })
    settings.behaviorForm.value.debugMode = true
    await settings.handleSave()

    expect(core.launcherConfig?.debugMode).toBe(true)
    expect(core.launcherConfig?.theme).toBe('lime-dark')
    expect(core.launcherConfig?.animationsEnabled).toBe(true)

    unmount()
  })

  it('saves whole positive speed limits and treats an empty field as no limit', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    const savedLimit = async (raw: number | null): Promise<number | null> => {
      vi.mocked(saveLauncherSettings).mockClear()
      settings.behaviorForm.value.downloadSpeedLimit = raw
      await settings.handleSave()
      const { calls } = vi.mocked(saveLauncherSettings).mock
      const lastCall = calls[calls.length - 1]
      return lastCall === undefined ? null : lastCall[0].downloadSpeedLimit
    }

    expect(await savedLimit(12)).toBe(12)
    expect(settings.downloadSpeedLimitError.value).toBe('')

    expect(await savedLimit(10_000_000)).toBe(10_000_000)
    expect(settings.downloadSpeedLimitError.value).toBe('')

    expect(await savedLimit(null)).toBeNull()
    expect(settings.downloadSpeedLimitError.value).toBe('')

    unmount()
  })

  it('blocks the save for non-positive, fractional and oversized speed limits', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    const blockedLimit = async (raw: number): Promise<void> => {
      vi.mocked(saveLauncherSettings).mockClear()
      settings.behaviorForm.value.downloadSpeedLimit = raw
      await settings.handleSave()
      expect(saveLauncherSettings).not.toHaveBeenCalled()
      expect(settings.downloadSpeedLimitError.value).toBe(
        'Ограничение скорости: целое число от 1 до 10000000 КБ/с',
      )
    }

    await blockedLimit(0)
    await blockedLimit(-5)
    await blockedLimit(12.5)
    await blockedLimit(10_000_001)
    await blockedLimit(Number.MAX_SAFE_INTEGER + 1)

    unmount()
  })

  it('does not nest the launcher folder when the selected path already ends with the launcher name', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)
    useCoreStore().launcherName = 'Limacina'

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    vi.mocked(selectDirectory).mockResolvedValue('/games/Limacina')
    await settings.selectLauncherFolder()
    expect(settings.launcherPath.value).toBe('/games/Limacina')

    vi.mocked(selectDirectory).mockResolvedValue('/games')
    await settings.selectLauncherFolder()
    expect(settings.launcherPath.value).toBe('/games/Limacina')

    unmount()
  })

  it('blocks the save while the speed limit input is invalid', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.behaviorForm.value.downloadSpeedLimit = 12.5
    await settings.handleSave()

    expect(saveLauncherSettings).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe(settings.downloadSpeedLimitError.value)

    settings.behaviorForm.value.downloadSpeedLimit = 12
    await settings.handleSave()

    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('tracks launcher path changes through the dirty snapshot', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.launcherPath.value = '/other'
    expect(settings.isDirty.value).toBe(true)

    settings.launcherPath.value = '/launcher'
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('registers the dirty tab in the settings registry and cleans up on unmount', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()
    const registry = useSettingsDirtyStore()
    expect(registry.hasDirtyTabs).toBe(false)

    settings.launcherPath.value = '/other'
    await flushPromises()
    expect(registry.dirtyTabs).toEqual(['launcher'])

    settings.launcherPath.value = '/launcher'
    await flushPromises()
    expect(registry.hasDirtyTabs).toBe(false)

    settings.launcherPath.value = '/other'
    await flushPromises()
    expect(registry.hasDirtyTabs).toBe(true)

    unmount()
    expect(registry.hasDirtyTabs).toBe(false)
  })

  it('hydrates and saves every behavior field through the single form object', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValueOnce(true).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    const samples: Pick<LauncherConfig, keyof LauncherBehaviorForm> = {
      discordActivity: true,
      autoUpdate: true,
      keepOldConfigs: true,
      startWithSystem: true,
      closeAfterLaunch: true,
      minimizeToTray: true,
      systemNotifications: true,
      debugMode: true,
      downloadSpeedLimit: 512,
    }
    vi.mocked(getAppInitData).mockResolvedValue(
      makeAppInitData({ ...makeLauncherConfig(false), ...samples }),
    )

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    const expectedForm: LauncherBehaviorForm = {
      discordActivity: true,
      autoUpdate: true,
      keepOldConfigs: true,
      startWithSystem: true,
      closeAfterLaunch: true,
      minimizeToTray: true,
      systemNotifications: true,
      debugMode: true,
      downloadSpeedLimit: 512,
    }
    for (const key of Object.keys(samples) as (keyof LauncherBehaviorForm)[]) {
      expect(settings.behaviorForm.value[key]).toBe(expectedForm[key])
    }

    const edited: LauncherBehaviorForm = {
      discordActivity: false,
      autoUpdate: false,
      keepOldConfigs: false,
      startWithSystem: false,
      closeAfterLaunch: false,
      minimizeToTray: false,
      systemNotifications: false,
      debugMode: false,
      downloadSpeedLimit: 256,
    }
    settings.behaviorForm.value = edited
    await settings.handleSave()

    const expectedPayload: LauncherSettingsPayload = {
      discordActivity: false,
      autoUpdate: false,
      keepOldConfigs: false,
      startWithSystem: false,
      closeAfterLaunch: false,
      minimizeToTray: false,
      systemNotifications: false,
      debugMode: false,
      downloadSpeedLimit: 256,
    }
    const { calls } = vi.mocked(saveLauncherSettings).mock
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toBeDefined()
    if (lastCall === undefined) return
    for (const key of Object.keys(expectedPayload) as (keyof LauncherSettingsPayload)[]) {
      expect(lastCall[0][key]).toBe(expectedPayload[key])
    }

    unmount()
  })
})
