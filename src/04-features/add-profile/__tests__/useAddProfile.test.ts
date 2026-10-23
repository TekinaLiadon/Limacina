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
import { makeProjectConfig } from '@/test-support/fixtures'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  clearSession: vi.fn(),
  createServerProfile: vi.fn(),
}))

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
    vi.mocked(createServerProfile).mockResolvedValue(makeProjectConfig({ projectName: 'example', online: false, initialized: false }))
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
    expect(created).toEqual(makeProjectConfig({ projectName: 'example', online: false, initialized: false }))
    expect(core.projects).toEqual(['example'])
    expect(core.currentProject).toBe('example')
    expect(core.projectConfig).toEqual(makeProjectConfig({ projectName: 'example', online: false, initialized: false }))
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

    releaseCreate(makeProjectConfig({ projectName: 'example', online: false, initialized: false }))
    const created = await first

    expect(created).toEqual(makeProjectConfig({ projectName: 'example', online: false, initialized: false }))
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
