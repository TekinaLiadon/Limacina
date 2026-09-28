import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useCoreStore,
  useNotificationStore,
  useSettingsStore,
  type AppInitData,
  type LauncherConfig,
  type ProjectConfig,
} from '@/05-entities'
import { useAppInit } from './useAppInit'
import { withSetup } from '@/test-support/withSetup'

const api = vi.hoisted(() => ({
  applyUpdateCmd: vi.fn(),
  checkUpdate: vi.fn(),
  getAppInitData: vi.fn(),
  loadSettingsProject: vi.fn(),
  preloadThemeFonts: vi.fn(),
}))

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  applyUpdateCmd: api.applyUpdateCmd,
  checkUpdate: api.checkUpdate,
  getAppInitData: api.getAppInitData,
  loadSettingsProject: api.loadSettingsProject,
}))

vi.mock('@/04-features/theme/preloadThemeFonts', () => ({
  preloadThemeFonts: api.preloadThemeFonts,
}))

vi.mock('vue-router', () => ({
  useRouter: (): { replace: (route: unknown) => void; push: (route: unknown) => void } => router,
}))

const makeLauncherConfig = (overrides: Partial<LauncherConfig> = {}): LauncherConfig => ({
  launcherPath: '/games/limacina',
  discordActivity: false,
  keepOldConfigs: true,
  downloadSpeedLimit: null,
  autoUpdate: false,
  systemNotifications: true,
  debugMode: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: true,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames: ['proj'],
  currentProject: 'proj',
  projects: {},
  ...overrides,
})

const makeInitData = (overrides: Partial<AppInitData> = {}): AppInitData => ({
  launcherName: 'Limacina',
  defaultParentPath: '/games',
  launcherConfig: makeLauncherConfig(),
  version: '1.0.0',
  totalMemoryMb: 16384,
  offlineBuild: false,
  envProjectName: null,
  ...overrides,
})

const makeProjectConfig = (name: string): ProjectConfig => ({
  projectName: name,
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online: true,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

describe('useAppInit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.applyUpdateCmd.mockReset()
    api.checkUpdate.mockReset()
    api.getAppInitData.mockReset()
    api.loadSettingsProject.mockReset()
    api.loadSettingsProject.mockResolvedValue(makeProjectConfig('proj'))
    api.preloadThemeFonts.mockReset()
    api.preloadThemeFonts.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const setupApp = (): { startupError: () => string; preloaderText: () => string; retryInit: () => Promise<void> } => {
    const { result } = withSetup(() => useAppInit())
    return {
      startupError: (): string => result.startupError.value,
      preloaderText: (): string => result.preloaderText.value,
      retryInit: result.retryInit,
    }
  }

  const runInit = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(1100)
  }

  it('hydrates the init data and loads the saved project', async () => {
    api.getAppInitData.mockResolvedValue(makeInitData())
    api.loadSettingsProject.mockResolvedValue(makeProjectConfig('proj'))

    const app = setupApp()
    await runInit()

    const core = useCoreStore()
    expect(core.launcherName).toBe('Limacina')
    expect(core.version).toBe('1.0.0')
    expect(core.totalMemoryMb).toBe(16384)
    expect(core.projects).toEqual(['proj'])
    expect(core.currentProject).toBe('proj')
    expect(core.projectConfig).toEqual(makeProjectConfig('proj'))
    expect(useSettingsStore().theme).toBe('default-dark')
    expect(useSettingsStore().animationsEnabled).toBe(true)
    expect(app.startupError()).toBe('')
    expect(core.isLoading).toBe(false)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('routes to the setup screen when there is no launcher config', async () => {
    api.getAppInitData.mockResolvedValue(makeInitData({ launcherConfig: null }))

    setupApp()
    await runInit()

    expect(router.replace).toHaveBeenCalledWith('/setup')
    expect(useCoreStore().isLoading).toBe(false)
  })

  it('routes to the offline profile setup for an empty offline build', async () => {
    api.getAppInitData.mockResolvedValue(
      makeInitData({ offlineBuild: true, launcherConfig: makeLauncherConfig({ projectNames: [], currentProject: null }) }),
    )

    setupApp()
    await runInit()

    expect(router.replace).toHaveBeenCalledWith({ name: 'Setup' })
  })

  it('applies the auto-update and rehydrates from fresh init data', async () => {
    api.getAppInitData
      .mockResolvedValueOnce(
        makeInitData({ launcherConfig: makeLauncherConfig({ autoUpdate: true, theme: 'default-dark' }) }),
      )
      .mockResolvedValueOnce(
        makeInitData({
          version: '2.0.0',
          launcherConfig: makeLauncherConfig({ autoUpdate: true, theme: 'lime-light', animationsEnabled: false }),
        }),
      )
    api.checkUpdate.mockResolvedValue({ version: '2.0.0' })
    api.applyUpdateCmd.mockResolvedValue(undefined)

    setupApp()
    await runInit()

    expect(api.checkUpdate).toHaveBeenCalledTimes(1)
    expect(api.applyUpdateCmd).toHaveBeenCalledWith()
    expect(api.getAppInitData).toHaveBeenCalledTimes(2)
    expect(useCoreStore().version).toBe('2.0.0')
    expect(useSettingsStore().theme).toBe('lime-light')
    expect(useSettingsStore().animationsEnabled).toBe(false)
    expect(useCoreStore().isLoading).toBe(false)
  })

  it('keeps initializing when the update check fails', async () => {
    api.getAppInitData.mockResolvedValue(
      makeInitData({ launcherConfig: makeLauncherConfig({ autoUpdate: true }) }),
    )
    api.checkUpdate.mockRejectedValue(new Error('manifest unreachable'))

    setupApp()
    await runInit()

    expect(api.applyUpdateCmd).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe('Не удалось проверить обновления: manifest unreachable')
    expect(useCoreStore().isLoading).toBe(false)
  })

  it('reports a project config failure through the startup error', async () => {
    api.getAppInitData.mockResolvedValue(makeInitData())
    api.loadSettingsProject.mockRejectedValue(new Error('config corrupted'))

    const app = setupApp()
    await runInit()

    expect(app.startupError()).toBe('config corrupted')
    expect(useCoreStore().isLoading).toBe(false)
  })

  it('skips the update check for offline builds', async () => {
    api.getAppInitData.mockResolvedValue(makeInitData({ offlineBuild: true }))
    setupApp()
    await runInit()

    expect(api.checkUpdate).not.toHaveBeenCalled()
  })

  it('retries the initialization after a failure', async () => {
    api.getAppInitData
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce(makeInitData())
    api.loadSettingsProject.mockResolvedValue(makeProjectConfig('proj'))

    const app = setupApp()
    await runInit()
    expect(app.startupError()).toBe('ipc down')

    const core = useCoreStore()
    await app.retryInit()
    await runInit()

    expect(app.startupError()).toBe('')
    expect(core.launcherName).toBe('Limacina')
    expect(core.isLoading).toBe(false)
  })
})
