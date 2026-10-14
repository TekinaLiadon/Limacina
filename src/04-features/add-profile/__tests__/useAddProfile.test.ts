import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { clearSession, createServerProfile } from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
} from '@/05-entities'
import { useAddProfile } from '../useAddProfile'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  clearSession: vi.fn(),
  createServerProfile: vi.fn(),
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
    vi.mocked(createServerProfile).mockReset()
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
    expect(useNotificationStore().message).toBe('Сервер "example" добавлен')
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
})
