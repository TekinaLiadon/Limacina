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
  useNotificationStore,
  type ProjectConfig,
} from '@/05-entities'
import { useAddProfile } from '../useAddProfile'
import { useOfflineProfileForm } from '../useOfflineProfileForm'

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

describe('useOfflineProfileForm', () => {
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

  const setupForms = (): {
    add: ReturnType<typeof useAddProfile>
    offline: ReturnType<typeof useOfflineProfileForm>
  } => {
    const add = useAddProfile()
    const offline = useOfflineProfileForm({
      isSubmitting: add.isSubmitting,
      errorMessage: add.errorMessage,
    })
    return { add, offline }
  }

  it('requires a name, a version and a loader version for the offline form', () => {
    const { offline } = setupForms()

    expect(offline.isOfflineValid.value).toBe(false)
    expect(offline.needsLoaderVersion.value).toBe(false)

    offline.offlineForm.value.name = 'My profile'
    expect(offline.isOfflineValid.value).toBe(false)

    offline.offlineForm.value.mcVersion = '1.20.1'
    expect(offline.isOfflineValid.value).toBe(true)

    offline.offlineForm.value.modLoader = 'fabric'
    expect(offline.needsLoaderVersion.value).toBe(true)
    expect(offline.isOfflineValid.value).toBe(false)

    offline.offlineForm.value.loaderVersion = '0.14.21'
    expect(offline.isOfflineValid.value).toBe(true)
  })

  it('loads the minecraft versions and picks the first one', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1', '1.19.4'])
    const { offline } = setupForms()

    await offline.selectKind('offline')

    expect(getMinecraftVersions).toHaveBeenCalledWith(false)
    expect(offline.mcVersionOptions.value).toEqual([
      { title: '1.20.1', value: '1.20.1' },
      { title: '1.19.4', value: '1.19.4' },
    ])
    expect(offline.offlineForm.value.mcVersion).toBe('1.20.1')
    expect(offline.isLoadingMcVersions.value).toBe(false)
  })

  it('reports the version list failure', async () => {
    vi.mocked(getMinecraftVersions).mockRejectedValue(new Error('manifest unreachable'))
    const { add, offline } = setupForms()

    await offline.selectKind('offline')

    expect(add.errorMessage.value).toBe('manifest unreachable')
    expect(offline.mcVersionOptions.value).toEqual([])
  })

  it('clears the shared error when the kind switches', async () => {
    vi.mocked(getMinecraftVersions).mockRejectedValue(new Error('manifest unreachable'))
    const { add, offline } = setupForms()

    await offline.selectKind('offline')
    expect(add.errorMessage.value).toBe('manifest unreachable')

    await offline.selectKind('server')

    expect(add.errorMessage.value).toBe('')
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
    const { offline } = setupForms()

    const selected = offline.selectKind('offline')
    offline.offlineForm.value.includeSnapshots = true
    await vi.waitFor(() => expect(offline.mcVersionOptions.value).toHaveLength(1))

    releaseOld(['1.19.4', '1.18.2'])

    expect(offline.mcVersionOptions.value).toHaveLength(1)
    expect(offline.offlineForm.value.mcVersion).toBe('1.20.1')
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
    const { offline } = setupForms()
    offline.offlineForm.value.name = 'My profile'
    await offline.selectKind('offline')

    offline.offlineForm.value.modLoader = 'fabric'
    await vi.waitFor(() => expect(offline.isLoadingLoaderVersions.value).toBe(true))

    offline.offlineForm.value.modLoader = 'vanilla'
    await vi.waitFor(() => expect(offline.offlineForm.value.loaderVersion).toBe(''))

    releaseLoader(['0.14.21'])
    await Promise.resolve()

    expect(offline.loaderVersionOptions.value).toHaveLength(0)
    expect(offline.offlineForm.value.loaderVersion).toBe('')
    expect(offline.isLoadingLoaderVersions.value).toBe(false)
    expect(offline.isOfflineValid.value).toBe(true)
  })

  it('clears the loader versions for vanilla', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    const { offline } = setupForms()
    await offline.selectKind('offline')
    offline.offlineForm.value.modLoader = 'fabric'
    vi.mocked(getLoaderVersions).mockResolvedValue(['0.14.21'])
    await vi.waitFor(() => expect(offline.loaderVersionOptions.value).toHaveLength(1))

    offline.offlineForm.value.modLoader = 'vanilla'
    await vi.waitFor(() => expect(offline.loaderVersionOptions.value).toHaveLength(0))

    expect(offline.offlineForm.value.loaderVersion).toBe('')
    expect(getLoaderVersions).toHaveBeenCalledTimes(1)
  })

  it('loads the loader versions for the selected loader', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    const { offline } = setupForms()
    await offline.selectKind('offline')

    offline.offlineForm.value.modLoader = 'forge'
    vi.mocked(getLoaderVersions).mockResolvedValue(['47.2.0', '47.1.0'])
    await vi.waitFor(() => expect(offline.loaderVersionOptions.value).toHaveLength(2))

    expect(getLoaderVersions).toHaveBeenCalledWith('forge', '1.20.1')
    expect(offline.offlineForm.value.loaderVersion).toBe('47.2.0')
  })

  it('explains the missing loader versions', async () => {
    vi.mocked(getMinecraftVersions).mockResolvedValue(['1.20.1'])
    const { add, offline } = setupForms()
    await offline.selectKind('offline')

    offline.offlineForm.value.modLoader = 'neoforge'
    vi.mocked(getLoaderVersions).mockResolvedValue([])
    await vi.waitFor(() => expect(add.errorMessage.value).not.toBe(''))

    expect(add.errorMessage.value).toBe('Нет версий neoforge для Minecraft 1.20.1')
    expect(offline.offlineForm.value.loaderVersion).toBe('')
  })

  it('creates the offline profile without a loader version for vanilla', async () => {
    vi.mocked(createOfflineProfile).mockResolvedValue(makeConfig('My profile'))
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const { offline } = setupForms()
    offline.offlineForm.value.name = '  My profile  '
    offline.offlineForm.value.mcVersion = '1.20.1'

    const created = await offline.submitOffline()

    expect(createOfflineProfile).toHaveBeenCalledWith('My profile', '1.20.1', 'vanilla', null)
    expect(created).toEqual(makeConfig('My profile'))
    expect(offline.offlineForm.value.name).toBe('')
    expect(useNotificationStore().message).toBe('Профиль «My profile» создан')
  })

  it('passes the loader version for a loader-based profile', async () => {
    vi.mocked(createOfflineProfile).mockResolvedValue(makeConfig('fabricated'))
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const { offline } = setupForms()
    offline.offlineForm.value.name = 'fabricated'
    offline.offlineForm.value.mcVersion = '1.20.1'
    offline.offlineForm.value.modLoader = 'fabric'
    offline.offlineForm.value.loaderVersion = '0.14.21'

    await offline.submitOffline()

    expect(createOfflineProfile).toHaveBeenCalledWith('fabricated', '1.20.1', 'fabric', '0.14.21')
  })

  it('does not submit an invalid offline form', async () => {
    const { offline } = setupForms()

    const created = await offline.submitOffline()

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
    const { add, offline } = setupForms()
    offline.offlineForm.value.name = 'My profile'
    offline.offlineForm.value.mcVersion = '1.20.1'

    const first = offline.submitOffline()
    const second = await offline.submitOffline()

    expect(second).toBeNull()
    expect(createOfflineProfile).toHaveBeenCalledTimes(1)
    expect(createOfflineProfile).toHaveBeenCalledWith('My profile', '1.20.1', 'vanilla', null)
    expect(add.isSubmitting.value).toBe(true)

    releaseCreate(makeConfig('My profile'))
    await first

    expect(add.isSubmitting.value).toBe(false)
  })

  it('ignores a server submit while the offline submit is running', async () => {
    let releaseCreate: (config: ProjectConfig) => void = () => {}
    vi.mocked(createOfflineProfile).mockImplementationOnce(
      () =>
        new Promise<ProjectConfig>((resolve) => {
          releaseCreate = resolve
        }),
    )
    const { add, offline } = setupForms()
    offline.offlineForm.value.name = 'My profile'
    offline.offlineForm.value.mcVersion = '1.20.1'
    add.serverForm.value.serverUrl = 'mc.example.com'

    const first = offline.submitOffline()
    const second = await add.submitServer()

    expect(second).toBeNull()
    expect(createServerProfile).not.toHaveBeenCalled()

    releaseCreate(makeConfig('My profile'))
    await first
  })
})
