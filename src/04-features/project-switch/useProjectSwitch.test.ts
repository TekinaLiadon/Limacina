import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  authLogins,
  clearSession,
  loadSettingsProject,
  saveCurrentProject,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
} from '@/05-entities'
import { useProjectSwitch } from './useProjectSwitch'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
  clearSession: vi.fn(),
  loadSettingsProject: vi.fn(),
  saveCurrentProject: vi.fn(),
}))

const makeConfig = (name: string, online: boolean): ProjectConfig => ({
  projectName: name,
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

describe('useProjectSwitch', () => {
  const setup = (): ReturnType<typeof useProjectSwitch> => useProjectSwitch()

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(authLogins).mockReset()
    vi.mocked(clearSession).mockReset()
    vi.mocked(loadSettingsProject).mockReset()
    vi.mocked(saveCurrentProject).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps projects into options and allows switching with several projects', () => {
    const core = useCoreStore()
    core.projects = ['alpha', 'beta']
    const ps = setup()

    expect(ps.projectOptions.value).toEqual([
      { title: 'alpha', value: 'alpha' },
      { title: 'beta', value: 'beta' },
    ])
    expect(ps.canSwitch.value).toBe(true)

    core.projects = ['alpha']
    expect(ps.canSwitch.value).toBe(false)
  })

  it('loads the config and logins and resets the auth state', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    const accounts = useAccountsStore()
    accounts.logins = ['stale']
    accounts.loginFormData.username = 'stale'
    accounts.showAuthForm = true

    vi.mocked(loadSettingsProject).mockResolvedValue(makeConfig('beta', true))
    vi.mocked(authLogins).mockResolvedValue(['carol'])
    const ps = setup()

    await ps.selectProject('beta')

    expect(saveCurrentProject).toHaveBeenCalledWith('beta')
    expect(core.currentProject).toBe('beta')
    expect(core.projectConfig).toEqual(makeConfig('beta', true))
    expect(accounts.logins).toEqual(['carol'])
    expect(accounts.showAuthForm).toBe(false)
    expect(accounts.loginFormData.username).toBe('')
    expect(core.isLoggedIn).toBe(false)
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(accounts.isSwitching).toBe(false)
  })

  it('ignores a no-op or empty selection', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    const ps = setup()

    await ps.selectProject('alpha')
    await ps.selectProject('')

    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('blocks the switch while a game session is active', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.gameUsername = 'alice'
    const ps = setup()

    await ps.selectProject('beta')

    expect(useNotificationStore().message).toBe('Нельзя переключить проект, пока запущена игра')
    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('blocks the switch while the game is launching', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    useAccountsStore().isLaunching = true
    const ps = setup()

    await ps.selectProject('beta')

    expect(useNotificationStore().message).toBe('Дождитесь завершения запуска игры')
    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('ignores a repeated switch while one is in flight', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    let releaseSave: () => void = () => {}
    vi.mocked(saveCurrentProject).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )
    const ps = setup()

    const first = ps.selectProject('beta')
    await ps.selectProject('gamma')

    releaseSave()
    await first

    expect(saveCurrentProject).toHaveBeenCalledTimes(1)
    expect(core.currentProject).toBe('beta')
  })

  it('shows the command error and keeps the current project on failure', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    vi.mocked(saveCurrentProject).mockRejectedValue(new Error('disk full'))
    const ps = setup()

    await ps.selectProject('beta')

    expect(useNotificationStore().message).toBe('disk full')
    expect(core.currentProject).toBe('alpha')
    expect(core.projectConfig).toBeNull()
    expect(useAccountsStore().isSwitching).toBe(false)
  })
})
