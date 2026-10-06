import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  authLogins,
  clearMinecraftConfig,
  clearSession,
  deleteProject,
  getServerConnectUrl,
  loadSettingsProject,
  refreshManifests,
  saveSettingsProject,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useLaunchStore,
  useNotificationStore,
  useProjectSettingsStore,
  type LauncherConfig,
  type ProjectConfig,
} from '@/05-entities'
import { useProjectSettings } from '../useProjectSettings'
import { withSetup } from '@/test-support/withSetup'

const api = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  selectDirectory: vi.fn(),
  probeJavaVersion: vi.fn(),
}))

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
  clearMinecraftConfig: vi.fn(),
  clearSession: vi.fn(),
  deleteProject: vi.fn(),
  getServerConnectUrl: vi.fn(),
  loadSettingsProject: vi.fn(),
  probeJavaVersion: api.probeJavaVersion,
  refreshManifests: vi.fn(),
  saveSettingsProject: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  copyToClipboard: api.copyToClipboard,
  selectDirectory: api.selectDirectory,
}))

vi.mock('vue-router', () => ({
  useRouter: (): { replace: (route: unknown) => void; push: (route: unknown) => void } => router,
}))

const makeProjectConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'fabric',
  loaderVersion: '0.14.21',
  javaPath: '/java/temurin',
  javaVersion: 17,
  jvmArgs: ['-Xms512M', '-XX:+UseG1GC'],
  minMemory: '-Xms512M',
  maxMemory: '-Xmx4G',
  online: true,
  initialized: true,
  serverUrl: 'https://example.com',
  autoJoinServer: false,
  ...overrides,
})

const makeLauncherConfig = (projectNames: string[]): LauncherConfig => ({
  launcherPath: '/games/limacina',
  installId: null,
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
  projectNames,
  currentProject: projectNames[0] ?? null,
  projects: {},
})

describe('useProjectSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(authLogins).mockReset()
    vi.mocked(clearMinecraftConfig).mockReset()
    vi.mocked(clearSession).mockReset()
    vi.mocked(deleteProject).mockReset()
    vi.mocked(getServerConnectUrl).mockReset()
    vi.mocked(loadSettingsProject).mockReset()
    vi.mocked(refreshManifests).mockReset()
    vi.mocked(saveSettingsProject).mockReset()
    api.probeJavaVersion.mockReset()
    api.copyToClipboard.mockReset()
    api.selectDirectory.mockReset()
    useCoreStore().currentProject = 'proj'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupSettings = (): ReturnType<typeof useProjectSettings> => {
    const { result } = withSetup(() => useProjectSettings())
    return result
  }

  const loadReady = async (): Promise<ReturnType<typeof useProjectSettings>> => {
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig())
    const settings = setupSettings()
    await vi.waitFor(() => expect(useProjectSettingsStore().isLoaded).toBe(true))
    return settings
  }

  it('maps the loaded config into the form', async () => {
    const settings = await loadReady()
    const store = useProjectSettingsStore()

    expect(settings.isLoaded.value).toBe(true)
    expect(settings.isLoading.value).toBe(false)
    expect(store.config.loaderVersion).toBe('0.14.21')
    expect(store.config.javaPath).toBe('/java/temurin')
    expect(store.config.jvmArgs).toBe('-Xms512M, -XX:+UseG1GC')
    expect(store.config.memoryRange).toEqual([512, 4096])
    expect(settings.isDirty.value).toBe(false)
  })

  it('falls back to the default memory values for unreadable entries', async () => {
    vi.mocked(loadSettingsProject).mockResolvedValue(
      makeProjectConfig({ minMemory: 'abc', maxMemory: '-Xmx2G', jvmArgs: [] }),
    )
    const settings = setupSettings()
    await vi.waitFor(() => expect(useProjectSettingsStore().isLoaded).toBe(true))

    expect(useProjectSettingsStore().config.memoryRange).toEqual([512, 2048])
    expect(useProjectSettingsStore().config.jvmArgs).toBe('')
    void settings
  })

  it('skips a reload for the loaded project but forces it on retry', async () => {
    const settings = await loadReady()

    await settings.loadConfig('proj')
    expect(loadSettingsProject).toHaveBeenCalledTimes(1)

    await settings.retryLoad()
    expect(loadSettingsProject).toHaveBeenCalledTimes(2)
  })

  it('reports the load error through the store', async () => {
    vi.mocked(loadSettingsProject).mockRejectedValue(new Error('config locked'))
    const settings = setupSettings()
    await vi.waitFor(() => expect(useProjectSettingsStore().loadError).toBe('config locked'))

    expect(settings.isLoaded.value).toBe(false)
    expect(settings.isLoading.value).toBe(false)
    expect(settings.loadError.value).toBe('config locked')
    expect(useProjectSettingsStore().config.projectName).toBe('')
  })

  it('shows the loading state without the previous project values while a retry is in flight', async () => {
    const settings = await loadReady()
    let release: () => void = () => {}
    vi.mocked(loadSettingsProject).mockImplementationOnce(
      () =>
        new Promise<ProjectConfig>((resolve) => {
          release = (): void => resolve(makeProjectConfig())
        }),
    )

    const pending = settings.retryLoad()

    expect(settings.isLoading.value).toBe(true)
    expect(useProjectSettingsStore().config.projectName).toBe('')

    release()
    await pending

    expect(settings.isLoading.value).toBe(false)
    expect(useProjectSettingsStore().config.projectName).toBe('proj')
  })

  it('picks the folder into the java path field', async () => {
    const settings = await loadReady()
    api.selectDirectory.mockResolvedValueOnce('/custom/java')

    await settings.selectJavaFolder()

    expect(useProjectSettingsStore().config.javaPath).toBe('/custom/java')
    expect(settings.isDirty.value).toBe(true)
  })

  it('probes the java version right after the folder is picked', async () => {
    const settings = await loadReady()
    api.selectDirectory.mockResolvedValueOnce('/custom/java')
    api.probeJavaVersion.mockResolvedValueOnce(21)

    await settings.selectJavaFolder()

    expect(api.probeJavaVersion).toHaveBeenCalledWith('/custom/java')
    expect(useProjectSettingsStore().config.javaVersion).toBe(21)
  })

  it('falls back to an unknown java version when the probe fails', async () => {
    const settings = await loadReady()
    api.selectDirectory.mockResolvedValueOnce('/broken/java')
    api.probeJavaVersion.mockRejectedValueOnce(new Error('no java found'))

    await settings.selectJavaFolder()

    expect(useProjectSettingsStore().config.javaPath).toBe('/broken/java')
    expect(useProjectSettingsStore().config.javaVersion).toBeNull()
    expect(useNotificationStore().message).toBe('no java found')
  })

  it('keeps the dirty baseline when the settings page remounts', async () => {
    await loadReady()
    const store = useProjectSettingsStore()
    store.config.javaPath = '/edited/java'
    expect(store.isDirty).toBe(true)

    const remounted = setupSettings()

    expect(remounted.isLoaded.value).toBe(true)
    expect(remounted.isDirty.value).toBe(true)
    expect(store.isFieldDirty('javaPath')).toBe(true)
    expect(loadSettingsProject).toHaveBeenCalledTimes(1)
  })

  it('saves only the dirty fields and keeps fresh external values', async () => {
    const settings = await loadReady()
    vi.mocked(loadSettingsProject).mockResolvedValue(
      makeProjectConfig({ loaderVersion: '9.9.9', javaPath: '/fresh/java' }),
    )
    vi.mocked(saveSettingsProject).mockResolvedValue(
      makeProjectConfig({ loaderVersion: '9.9.9', javaPath: '/local/java' }),
    )

    useProjectSettingsStore().config.javaPath = '/local/java'
    await settings.handleSave()

    expect(loadSettingsProject).toHaveBeenCalledTimes(2)
    expect(saveSettingsProject).toHaveBeenCalledWith(
      expect.objectContaining({
        javaPath: '/local/java',
        loaderVersion: '9.9.9',
        minMemory: '-Xms512M',
        maxMemory: '-Xmx4G',
      }),
    )
    expect(useCoreStore().projectConfig?.javaPath).toBe('/local/java')
    expect(useCoreStore().projectConfig?.loaderVersion).toBe('9.9.9')
    expect(useProjectSettingsStore().config.loaderVersion).toBe('9.9.9')
    expect(useProjectSettingsStore().config.javaPath).toBe('/local/java')
    expect(useNotificationStore().message).toBe('Настройки сохранены')
    expect(settings.isDirty.value).toBe(false)
    expect(settings.isSaving.value).toBe(false)
  })

  it('refreshes the form from the server response after the save', async () => {
    const settings = await loadReady()
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig())
    vi.mocked(saveSettingsProject).mockResolvedValue(
      makeProjectConfig({ javaVersion: 21, minMemory: '-Xms1024M', maxMemory: '-Xmx4096M' }),
    )

    useProjectSettingsStore().config.memoryRange = [1024, 4096]
    await settings.handleSave()

    expect(useProjectSettingsStore().config.javaVersion).toBe(21)
    expect(useCoreStore().projectConfig?.javaVersion).toBe(21)
    expect(useNotificationStore().message).toBe('Настройки сохранены')
    expect(settings.isDirty.value).toBe(false)
  })

  it('splits the jvm args and applies the memory range when edited', async () => {
    const settings = await loadReady()
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig())
    vi.mocked(saveSettingsProject).mockResolvedValue(makeProjectConfig())
    const store = useProjectSettingsStore()

    store.config.jvmArgs = ' -Xms512M, -XX:+UseG1GC ,, '
    store.config.memoryRange = [1024, 8192]
    await settings.handleSave()

    expect(saveSettingsProject).toHaveBeenCalledWith(
      expect.objectContaining({
        jvmArgs: ['-Xms512M', '-XX:+UseG1GC'],
        minMemory: '-Xms1024M',
        maxMemory: '-Xmx8192M',
      }),
    )
  })

  it('splits space-separated jvm args into separate argv entries', async () => {
    const settings = await loadReady()
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig())
    vi.mocked(saveSettingsProject).mockResolvedValue(makeProjectConfig())
    useProjectSettingsStore().config.jvmArgs = '-Xms512M -XX:+UseG1GC'

    await settings.handleSave()

    expect(saveSettingsProject).toHaveBeenCalledWith(
      expect.objectContaining({ jvmArgs: ['-Xms512M', '-XX:+UseG1GC'] }),
    )
  })

  it('flags quote characters in the jvm args field', async () => {
    const settings = await loadReady()

    useProjectSettingsStore().config.jvmArgs = '-XX:+UseG1GC "-a, b"'
    expect(settings.jvmArgsError.value).not.toBe('')

    useProjectSettingsStore().config.jvmArgs = '-XX:+UseG1GC -Xmx2G'
    expect(settings.jvmArgsError.value).toBe('')
  })

  it('blocks the save while the edited jvm args contain quotes', async () => {
    const settings = await loadReady()
    vi.mocked(saveSettingsProject).mockResolvedValue(makeProjectConfig())
    useProjectSettingsStore().config.jvmArgs = '"-Xmx2G"'

    await settings.handleSave()

    expect(saveSettingsProject).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe(settings.jvmArgsError.value)
  })

  it('saves untouched quoted jvm args from the stored config without blocking', async () => {
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig({ jvmArgs: ['"-Xmx2G"'] }))
    const settings = setupSettings()
    await vi.waitFor(() => expect(useProjectSettingsStore().isLoaded).toBe(true))
    vi.mocked(saveSettingsProject).mockResolvedValue(makeProjectConfig())

    expect(settings.jvmArgsError.value).not.toBe('')
    await settings.handleSave()

    expect(saveSettingsProject).toHaveBeenCalledTimes(1)
  })

  it('ignores the save while the config is not loaded', async () => {
    const settings = setupSettings()

    await settings.handleSave()

    expect(saveSettingsProject).not.toHaveBeenCalled()
  })

  it('ignores a repeated save while one is in flight', async () => {
    const settings = await loadReady()
    let release: () => void = () => {}
    vi.mocked(saveSettingsProject).mockImplementationOnce(
      () =>
        new Promise<ProjectConfig>((resolve) => {
          release = (): void => resolve(makeProjectConfig())
        }),
    )
    useProjectSettingsStore().config.javaPath = '/local/java'

    const first = settings.handleSave()
    await settings.handleSave()
    release()
    await first

    expect(saveSettingsProject).toHaveBeenCalledTimes(1)
  })

  it('aborts the save when the project switches during the fresh load', async () => {
    const core = useCoreStore()
    const settings = await loadReady()
    vi.mocked(loadSettingsProject).mockImplementation(async () => {
      core.currentProject = 'beta'
      return makeProjectConfig({ projectName: 'beta' })
    })
    useProjectSettingsStore().config.javaPath = '/local/java'

    await settings.handleSave()

    expect(saveSettingsProject).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(core.projectConfig?.projectName).toBe('beta'))
    expect(useNotificationStore().message).toBe('')
    expect(settings.isSaving.value).toBe(false)
  })

  it('does not overwrite the project config when the project switches during the save', async () => {
    const core = useCoreStore()
    const settings = await loadReady()
    vi.mocked(saveSettingsProject).mockImplementation(async () => {
      core.currentProject = 'beta'
      return makeProjectConfig({ projectName: 'beta' })
    })
    useProjectSettingsStore().config.javaPath = '/local/java'

    await settings.handleSave()

    expect(saveSettingsProject).toHaveBeenCalledTimes(1)
    expect(core.projectConfig?.javaPath).not.toBe('/local/java')
    expect(useNotificationStore().message).toBe('')
    expect(settings.isSaving.value).toBe(false)
  })

  it('shows the save error', async () => {
    const settings = await loadReady()
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig())
    vi.mocked(saveSettingsProject).mockRejectedValue(new Error('disk full'))

    useProjectSettingsStore().config.javaPath = '/local/java'
    await settings.handleSave()

    expect(useNotificationStore().message).toBe('disk full')
    expect(settings.isSaving.value).toBe(false)
  })

  it('computes the memory limit from the total ram', async () => {
    const core = useCoreStore()
    const settings = await loadReady()

    core.totalMemoryMb = 16384
    expect(settings.maxMemoryLimit.value).toBe(14336)

    core.totalMemoryMb = 0
    expect(settings.maxMemoryLimit.value).toBe(512)
  })

  it('loads and copies the server connect url', async () => {
    const settings = await loadReady()
    vi.mocked(getServerConnectUrl).mockResolvedValue('https://example.com/join')

    await settings.handleGetConnectUrl()
    expect(settings.serverConnectUrl.value).toBe('https://example.com/join')

    api.copyToClipboard.mockResolvedValueOnce(undefined)
    await settings.handleCopyConnectUrl()
    expect(api.copyToClipboard).toHaveBeenCalledWith('https://example.com/join')
    expect(useNotificationStore().message).toBe('Ссылка скопирована')
  })

  it('shows the connect url errors', async () => {
    const settings = await loadReady()
    vi.mocked(getServerConnectUrl).mockRejectedValue(new Error('offline'))

    await settings.handleGetConnectUrl()
    expect(useNotificationStore().message).toBe('offline')

    settings.serverConnectUrl.value = 'https://example.com/join'
    api.copyToClipboard.mockRejectedValueOnce(new Error('clipboard blocked'))
    await settings.handleCopyConnectUrl()
    expect(useNotificationStore().message).toBe('clipboard blocked')
  })

  it('skips copying an empty connect url', async () => {
    const settings = await loadReady()

    await settings.handleCopyConnectUrl()

    expect(api.copyToClipboard).not.toHaveBeenCalled()
  })

  it('clears the minecraft config after confirmation', async () => {
    const settings = await loadReady()
    vi.mocked(clearMinecraftConfig).mockResolvedValue('Папка переименована')

    const pending = settings.handleClearMinecraftConfig()
    useNotificationStore().resolvePopup(false)
    await pending
    expect(clearMinecraftConfig).not.toHaveBeenCalled()

    const pendingOk = settings.handleClearMinecraftConfig()
    useNotificationStore().resolvePopup(true)
    await pendingOk

    expect(clearMinecraftConfig).toHaveBeenCalledTimes(1)
    expect(useNotificationStore().message).toBe('Папка переименована')
    expect(settings.isClearingConfig.value).toBe(false)
  })

  it('refreshes the manifests', async () => {
    const settings = await loadReady()
    vi.mocked(refreshManifests).mockResolvedValue('Манифесты обновлены')

    await settings.handleRefreshManifests()

    expect(refreshManifests).toHaveBeenCalledTimes(1)
    expect(useNotificationStore().message).toBe('Манифесты обновлены')
  })

  it('blocks the delete while the game is running or launching', async () => {
    const settings = await loadReady()
    const core = useCoreStore()
    const launch = useLaunchStore()

    core.gameUsername = 'alice'
    await settings.handleDeleteProject()
    expect(useNotificationStore().message).toBe('Нельзя удалить проект, пока запущена игра')

    core.gameUsername = null
    launch.isLaunching = true
    await settings.handleDeleteProject()
    expect(useNotificationStore().message).toBe('Дождитесь завершения запуска игры')
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('protects the env project from deletion', async () => {
    const core = useCoreStore()
    core.envProjectName = 'proj'
    const settings = await loadReady()

    expect(settings.canDeleteProject.value).toBe(false)
  })

  it('deletes the project and switches to the remaining one', async () => {
    vi.mocked(deleteProject).mockResolvedValue(makeLauncherConfig(['beta']))
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig({ projectName: 'beta' }))
    vi.mocked(authLogins).mockResolvedValue([])
    const settings = setupSettings()
    await vi.waitFor(() => expect(useProjectSettingsStore().loadedProject).toBe('proj'))

    const pending = settings.handleDeleteProject()
    useNotificationStore().resolvePopup(true)
    await pending

    expect(deleteProject).toHaveBeenCalledTimes(1)
    const core = useCoreStore()
    expect(core.projects).toEqual(['beta'])
    expect(core.currentProject).toBe('beta')
    expect(core.isLoggedIn).toBe(false)
    expect(useAccountsStore().logins).toEqual([])
    expect(useNotificationStore().message).toBe('Проект удалён')
    expect(settings.isDeleting.value).toBe(false)
  })

  it('routes to the add-profile screen after deleting the last project', async () => {
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig())
    vi.mocked(deleteProject).mockResolvedValue(makeLauncherConfig([]))
    const settings = setupSettings()
    await vi.waitFor(() => expect(useProjectSettingsStore().loadedProject).toBe('proj'))

    const pending = settings.handleDeleteProject()
    useNotificationStore().resolvePopup(true)
    await pending

    expect(useCoreStore().currentProject).toBe('')
    expect(useCoreStore().projectConfig).toBeNull()
    expect(router.push).toHaveBeenCalledWith({ name: 'AddProfile' })
  })

  it('keeps the project when the deletion is declined', async () => {
    const settings = await loadReady()

    const pending = settings.handleDeleteProject()
    useNotificationStore().resolvePopup(false)
    await pending

    expect(deleteProject).not.toHaveBeenCalled()
    expect(useCoreStore().currentProject).toBe('proj')
  })
})
