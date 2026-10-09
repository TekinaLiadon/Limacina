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
  useLaunchStore,
  useNotificationStore,
  useProjectSettingsStore,
  useSettingsDirtyStore,
  type ProjectConfig,
} from '@/05-entities'
import { useProjectSwitch } from '../useProjectSwitch'

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

  it('loads the config and logins and resets the auth and launch state', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    const accounts = useAccountsStore()
    accounts.logins = ['stale']
    accounts.loginFormData.username = 'stale'
    accounts.showAuthForm = true
    const launch = useLaunchStore()
    launch.prefillSteps([
      { key: 'java.check', label: 'Проверка Java' },
    ])
    launch.loginError = 'stale error'
    launch.launchInterrupted = true

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
    expect(launch.launchSteps).toEqual([])
    expect(launch.loginError).toBe('')
    expect(launch.launchInterrupted).toBe(false)
    expect(launch.isLaunching).toBe(false)
    expect(core.isLoggedIn).toBe(false)
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(accounts.isSwitching).toBe(false)
  })

  it('adopts the settings form from the committed project config', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    vi.mocked(saveCurrentProject).mockResolvedValue(undefined)
    vi.mocked(loadSettingsProject).mockResolvedValue(makeConfig('beta', true))
    vi.mocked(authLogins).mockResolvedValue([])

    const ps = setup()
    await ps.applyProjectSwitch('beta')

    const settings = useProjectSettingsStore()
    expect(settings.isLoaded).toBe(true)
    expect(settings.loadedProject).toBe('beta')
    expect(settings.config.projectName).toBe('beta')
    expect(settings.isDirty).toBe(false)
    expect(loadSettingsProject).toHaveBeenCalledTimes(1)
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
    useLaunchStore().isLaunching = true
    const ps = setup()

    await ps.selectProject('beta')

    expect(useNotificationStore().message).toBe('Дождитесь завершения запуска игры')
    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('blocks the switch while a login or an account select is in flight', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    const accounts = useAccountsStore()

    accounts.authLoading = true
    const ps = setup()
    await ps.selectProject('beta')

    expect(useNotificationStore().message).toBe('Дождитесь завершения авторизации')
    expect(saveCurrentProject).not.toHaveBeenCalled()

    accounts.authLoading = false
    accounts.isLoading = true
    await ps.selectProject('beta')

    expect(useNotificationStore().message).toBe('Дождитесь завершения авторизации')
    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('asks for confirmation when the project settings are dirty and proceeds on accept', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    const settings = useProjectSettingsStore()
    settings.startLoading('alpha')
    settings.applyLoaded('alpha', {
      projectName: 'alpha',
      mcVersion: '1.20.1',
      modLoader: 'vanilla',
      loaderVersion: '',
      javaPath: '',
      javaVersion: null,
      jvmArgs: '',
      memoryRange: [512, 4096],
      online: true,
      initialized: true,
      serverUrl: null,
      autoJoinServer: false,
    })
    settings.config.jvmArgs = '-XX:+UseG1GC'
    expect(settings.isDirty).toBe(true)

    vi.mocked(loadSettingsProject).mockResolvedValue(makeConfig('beta', true))
    vi.mocked(authLogins).mockResolvedValue(['carol'])
    const ps = setup()

    const pending = ps.selectProject('beta')
    await vi.waitFor(() => expect(useNotificationStore().popupVisible).toBe(true))
    useNotificationStore().resolvePopup(true)
    await pending

    expect(core.currentProject).toBe('beta')
    expect(saveCurrentProject).toHaveBeenCalledWith('beta')
  })

  it('keeps the project when the dirty-settings confirmation is declined', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    const settings = useProjectSettingsStore()
    settings.startLoading('alpha')
    settings.applyLoaded('alpha', {
      projectName: 'alpha',
      mcVersion: '1.20.1',
      modLoader: 'vanilla',
      loaderVersion: '',
      javaPath: '',
      javaVersion: null,
      jvmArgs: '',
      memoryRange: [512, 4096],
      online: true,
      initialized: true,
      serverUrl: null,
      autoJoinServer: false,
    })
    settings.config.javaPath = '/java/custom'

    const ps = setup()

    const pending = ps.selectProject('beta')
    await vi.waitFor(() => expect(useNotificationStore().popupVisible).toBe(true))
    useNotificationStore().resolvePopup(false)
    await pending

    expect(core.currentProject).toBe('alpha')
    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('asks for confirmation when other settings tabs have unsaved edits', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    useSettingsDirtyStore().setTabDirty('game', true)
    const ps = setup()

    const pending = ps.selectProject('beta')
    await vi.waitFor(() => expect(useNotificationStore().popupVisible).toBe(true))
    useNotificationStore().resolvePopup(false)
    await pending

    expect(core.currentProject).toBe('alpha')
    expect(saveCurrentProject).not.toHaveBeenCalled()
  })

  it('switches without confirmation when nothing is dirty', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    vi.mocked(loadSettingsProject).mockResolvedValue(makeConfig('beta', true))
    vi.mocked(authLogins).mockResolvedValue(['carol'])
    const ps = setup()

    await ps.selectProject('beta')

    expect(useNotificationStore().popupVisible).toBe(false)
    expect(core.currentProject).toBe('beta')
  })

  it('completes the switch when the session finalization fails', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    core.projects = ['alpha', 'beta']
    core.isLoggedIn = true
    core.session = { uuid: 'u-1', username: 'alice' }
    vi.mocked(loadSettingsProject).mockResolvedValue(makeConfig('beta', true))
    vi.mocked(authLogins).mockResolvedValue(['carol'])
    vi.mocked(clearSession).mockRejectedValue(new Error('session stuck'))
    const ps = setup()

    await ps.selectProject('beta')

    expect(saveCurrentProject).toHaveBeenCalledTimes(1)
    expect(saveCurrentProject).toHaveBeenCalledWith('beta')
    expect(core.currentProject).toBe('beta')
    expect(core.isLoggedIn).toBe(false)
    expect(useAccountsStore().logins).toEqual(['carol'])
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

  it('restores the saved project when the switch fails during the load', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    vi.mocked(loadSettingsProject).mockRejectedValue(new Error('config locked'))
    const ps = setup()

    await ps.selectProject('beta')

    expect(saveCurrentProject).toHaveBeenNthCalledWith(1, 'beta')
    expect(saveCurrentProject).toHaveBeenNthCalledWith(2, 'alpha')
    expect(core.currentProject).toBe('alpha')
    expect(core.projectConfig).toBeNull()
    expect(useNotificationStore().message).toBe('config locked')
  })
})
