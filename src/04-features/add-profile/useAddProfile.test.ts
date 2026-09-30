import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  clearSession,
  createOfflineProfile,
  createServerProfile,
  getLoaderVersions,
  getMinecraftVersions,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
} from '@/05-entities'
import { useAddProfile } from './useAddProfile'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  clearSession: vi.fn(),
  createOfflineProfile: vi.fn(),
  createServerProfile: vi.fn(),
  getLoaderVersions: vi.fn(),
  getMinecraftVersions: vi.fn(),
}))

const makeConfig = (name: string): ProjectConfig => ({
  projectName: name,
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online: false,
  initialized: false,
  serverUrl: null,
  autoJoinServer: false,
})

describe('useAddProfile', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(clearSession).mockReset()
    vi.mocked(createOfflineProfile).mockReset()
    vi.mocked(createServerProfile).mockReset()
    vi.mocked(getLoaderVersions).mockReset()
    vi.mocked(getMinecraftVersions).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('validates the server form by the trimmed url', () => {
    const add = useAddProfile()

    expect(add.isServerValid.value).toBe(false)

    add.serverForm.value.serverUrl = '   '
    expect(add.isServerValid.value).toBe(false)

    add.serverForm.value.serverUrl = 'mc.example.com'
    expect(add.isServerValid.value).toBe(true)
  })

  it('requires a name, a version and a loader version for the offline form', () => {
    const add = useAddProfile()

    expect(add.isOfflineValid.value).toBe(false)
    expect(add.needsLoaderVersion.value).toBe(false)

    add.offlineForm.value.name = 'My profile'
    expect(add.isOfflineValid.value).toBe(false)

    add.offlineForm.value.mcVersion = '1.20.1'
    expect(add.isOfflineValid.value).toBe(true)

    add.offlineForm.value.modLoader = 'fabric'
    expect(add.needsLoaderVersion.value).toBe(true)
    expect(add.isOfflineValid.value).toBe(false)

    add.offlineForm.value.loaderVersion = '0.14.21'
    expect(add.isOfflineValid.value).toBe(true)
  })

  it('loads the minecraft versions and picks the first one', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1', '1.19.4'])
    const add = useAddProfile()

    await add.selectKind('offline')

    expect(getMinecraftVersions).toHaveBeenCalledWith(false)
    expect(add.mcVersionOptions.value).toEqual([
      { title: '1.20.1', value: '1.20.1' },
      { title: '1.19.4', value: '1.19.4' },
    ])
    expect(add.offlineForm.value.mcVersion).toBe('1.20.1')
    expect(add.isLoadingMcVersions.value).toBe(false)
  })

  it('reports the version list failure', async () => {
    vi.mocked(getMinecraftVersions).mockRejectedValue(new Error('manifest unreachable'))
    const add = useAddProfile()

    await add.selectKind('offline')

    expect(add.errorMessage.value).toBe('manifest unreachable')
    expect(add.mcVersionOptions.value).toEqual([])
  })

  it('drops a stale version list after a newer request', async () => {
    let releaseOld: (versions: string[]) => void = () => {}
    vi.mocked(getMinecraftVersions)
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            releaseOld = resolve
          }),
      )
      .mockResolvedValueOnce(['1.20.1'])
    const add = useAddProfile()

    const selected = add.selectKind('offline')
    add.offlineForm.value.includeSnapshots = true
    await vi.waitFor(() => expect(add.mcVersionOptions.value).toHaveLength(1))

    releaseOld(['1.19.4', '1.18.2'])

    expect(add.mcVersionOptions.value).toHaveLength(1)
    expect(add.offlineForm.value.mcVersion).toBe('1.20.1')
    await selected
  })

  it('drops the in-flight loader versions when the loader switches to vanilla', async () => {
    let releaseLoader: (versions: string[]) => void = () => {}
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    vi.mocked(getLoaderVersions).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          releaseLoader = resolve
        }),
    )
    const add = useAddProfile()
    add.offlineForm.value.name = 'My profile'
    await add.selectKind('offline')

    add.offlineForm.value.modLoader = 'fabric'
    await vi.waitFor(() => expect(add.isLoadingLoaderVersions.value).toBe(true))

    add.offlineForm.value.modLoader = 'vanilla'
    await vi.waitFor(() => expect(add.offlineForm.value.loaderVersion).toBe(''))

    releaseLoader(['0.14.21'])
    await Promise.resolve()

    expect(add.loaderVersionOptions.value).toHaveLength(0)
    expect(add.offlineForm.value.loaderVersion).toBe('')
    expect(add.isLoadingLoaderVersions.value).toBe(false)
    expect(add.isOfflineValid.value).toBe(true)
  })

  it('clears the loader versions for vanilla', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    const add = useAddProfile()
    await add.selectKind('offline')
    add.offlineForm.value.modLoader = 'fabric'
    vi.mocked(getLoaderVersions).mockResolvedValue(['0.14.21'])
    await vi.waitFor(() => expect(add.loaderVersionOptions.value).toHaveLength(1))

    add.offlineForm.value.modLoader = 'vanilla'
    await vi.waitFor(() => expect(add.loaderVersionOptions.value).toHaveLength(0))

    expect(add.offlineForm.value.loaderVersion).toBe('')
    expect(getLoaderVersions).toHaveBeenCalledTimes(1)
  })

  it('loads the loader versions for the selected loader', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    const add = useAddProfile()
    await add.selectKind('offline')

    add.offlineForm.value.modLoader = 'forge'
    vi.mocked(getLoaderVersions).mockResolvedValue(['47.2.0', '47.1.0'])
    await vi.waitFor(() => expect(add.loaderVersionOptions.value).toHaveLength(2))

    expect(getLoaderVersions).toHaveBeenCalledWith('forge', '1.20.1')
    expect(add.offlineForm.value.loaderVersion).toBe('47.2.0')
  })

  it('explains the missing loader versions', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    const add = useAddProfile()
    await add.selectKind('offline')

    add.offlineForm.value.modLoader = 'neoforge'
    vi.mocked(getLoaderVersions).mockResolvedValue([])
    await vi.waitFor(() => expect(add.errorMessage.value).not.toBe(''))

    expect(add.errorMessage.value).toBe('Нет версий neoforge для Minecraft 1.20.1')
    expect(add.offlineForm.value.loaderVersion).toBe('')
  })

  it('creates the server profile and activates it', async () => {
    vi.mocked(createServerProfile).mockResolvedValue(makeConfig('example'))
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const core = useCoreStore()
    core.launcherConfig = {
      launcherPath: '',
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
      projectNames: [],
      currentProject: null,
      projects: {},
    }
    useAccountsStore().logins = ['stale']
    const add = useAddProfile()
    add.serverForm.value.serverUrl = '  mc.example.com  '

    const created = await add.submitServer()

    expect(createServerProfile).toHaveBeenCalledWith('mc.example.com')
    expect(created).toEqual(makeConfig('example'))
    expect(core.projects).toEqual(['example'])
    expect(core.currentProject).toBe('example')
    expect(core.projectConfig).toEqual(makeConfig('example'))
    expect(core.launcherConfig?.projectNames).toEqual(['example'])
    expect(core.launcherConfig?.currentProject).toBe('example')
    expect(useAccountsStore().logins).toEqual([])
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(add.serverForm.value.serverUrl).toBe('')
    expect(useNotificationStore().message).toBe('Сервер «example» добавлен')
    expect(add.isSubmitting.value).toBe(false)
  })

  it('does not submit an invalid server form', async () => {
    const add = useAddProfile()

    const created = await add.submitServer()

    expect(created).toBeNull()
    expect(createServerProfile).not.toHaveBeenCalled()
  })

  it('ignores a server submit while another submit is running', async () => {
    let releaseCreate: (config: ProjectConfig) => void = () => {}
    vi.mocked(createServerProfile).mockImplementationOnce(
      () =>
        new Promise<ProjectConfig>((resolve) => {
          releaseCreate = resolve
        }),
    )
    const add = useAddProfile()
    add.serverForm.value.serverUrl = 'mc.example.com'

    const first = add.submitServer()
    const second = await add.submitServer()

    expect(second).toBeNull()
    expect(createServerProfile).toHaveBeenCalledTimes(1)
    expect(createServerProfile).toHaveBeenCalledWith('mc.example.com')
    expect(add.isSubmitting.value).toBe(true)

    releaseCreate(makeConfig('example'))
    const created = await first

    expect(created).toEqual(makeConfig('example'))
    expect(add.isSubmitting.value).toBe(false)
  })

  it('surfaces the server creation error', async () => {
    vi.mocked(createServerProfile).mockRejectedValue(new Error('unreachable server'))
    const add = useAddProfile()
    add.serverForm.value.serverUrl = 'mc.example.com'

    const created = await add.submitServer()

    expect(created).toBeNull()
    expect(add.errorMessage.value).toBe('unreachable server')
  })

  it('creates the offline profile without a loader version for vanilla', async () => {
    vi.mocked(createOfflineProfile).mockResolvedValue(makeConfig('My profile'))
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const add = useAddProfile()
    add.offlineForm.value.name = '  My profile  '
    add.offlineForm.value.mcVersion = '1.20.1'

    const created = await add.submitOffline()

    expect(createOfflineProfile).toHaveBeenCalledWith('My profile', '1.20.1', 'vanilla', null)
    expect(created).toEqual(makeConfig('My profile'))
    expect(add.offlineForm.value.name).toBe('')
    expect(useNotificationStore().message).toBe('Профиль «My profile» создан')
  })

  it('passes the loader version for a loader-based profile', async () => {
    vi.mocked(createOfflineProfile).mockResolvedValue(makeConfig('fabricated'))
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const add = useAddProfile()
    add.offlineForm.value.name = 'fabricated'
    add.offlineForm.value.mcVersion = '1.20.1'
    add.offlineForm.value.modLoader = 'fabric'
    add.offlineForm.value.loaderVersion = '0.14.21'

    await add.submitOffline()

    expect(createOfflineProfile).toHaveBeenCalledWith('fabricated', '1.20.1', 'fabric', '0.14.21')
  })

  it('does not submit an invalid offline form', async () => {
    const add = useAddProfile()

    const created = await add.submitOffline()

    expect(created).toBeNull()
    expect(createOfflineProfile).not.toHaveBeenCalled()
  })

  it('ignores an offline submit while another submit is running', async () => {
    let releaseCreate: (config: ProjectConfig) => void = () => {}
    vi.mocked(createOfflineProfile).mockImplementationOnce(
      () =>
        new Promise<ProjectConfig>((resolve) => {
          releaseCreate = resolve
        }),
    )
    const add = useAddProfile()
    add.offlineForm.value.name = 'My profile'
    add.offlineForm.value.mcVersion = '1.20.1'

    const first = add.submitOffline()
    const second = await add.submitOffline()

    expect(second).toBeNull()
    expect(createOfflineProfile).toHaveBeenCalledTimes(1)
    expect(createOfflineProfile).toHaveBeenCalledWith('My profile', '1.20.1', 'vanilla', null)
    expect(add.isSubmitting.value).toBe(true)

    releaseCreate(makeConfig('My profile'))
    await first

    expect(add.isSubmitting.value).toBe(false)
  })
})
