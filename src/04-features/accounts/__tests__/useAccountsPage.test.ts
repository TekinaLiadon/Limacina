import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  authLogins,
  clearSession,
  deleteAccount,
  downloadJava,
  downloadMinecraft,
  exitLauncher,
  getGameState,
  getSessionInfo,
  initializeProject,
  loadInstallJournal,
  loadSettingsProject,
  saveCurrentProject,
  setInitialized,
  startMinecraft,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useLaunchStore,
  useNotificationStore,
  useServerStore,
  type ProjectConfig,
  type StepProgressItem,
} from '@/05-entities'
import { useAccountsPage } from '../useAccountsPage'
import { useProjectSwitch } from '@/04-features/project-switch/useProjectSwitch'
import { withSetup } from '@/test-support/withSetup'
import { makeProjectConfig } from '@/test-support/fixtures'

const stubs = vi.hoisted(() => ({
  executeSteps: vi.fn(),
  sendSystemNotification: vi.fn(),
  isIntegrityCheckRunning: vi.fn(),
  useRealGameLaunch: false,
}))

const streamStubs = vi.hoisted(() => ({
  prefillLaunchSteps: vi.fn(),
  resetLaunchSteps: vi.fn(),
  flushLaunchSteps: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
  clearSession: vi.fn(),
  deleteAccount: vi.fn(),
  downloadJava: vi.fn(),
  downloadMinecraft: vi.fn(),
  exitLauncher: vi.fn(),
  getGameState: vi.fn(),
  getSessionInfo: vi.fn(),
  initializeProject: vi.fn(),
  listenGameExit: vi.fn(async (): Promise<() => void> => () => {}),
  listenGameStarted: vi.fn(async (): Promise<() => void> => () => {}),
  loadInstallJournal: vi.fn(),
  loadSettingsProject: vi.fn(),
  saveCurrentProject: vi.fn(),
  setInitialized: vi.fn(),
  startMinecraft: vi.fn(),
}))

vi.mock('@/04-features/game-launch/useLaunchStepsStream', () => ({
  useLaunchStepsStream: () => streamStubs,
}))

vi.mock('@/04-features/game-launch/useGameLaunch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features/game-launch/useGameLaunch')>()
  return {
    ...actual,
    useGameLaunch: (): ReturnType<typeof actual.useGameLaunch> =>
      stubs.useRealGameLaunch
        ? actual.useGameLaunch()
        : {
            launchSteps: computed((): StepProgressItem[] => []),
            activeProgress: computed((): number => 0),
            executeSteps: stubs.executeSteps,
          },
  }
})

vi.mock('@/04-features/integrity-check/useIntegrityCheck', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features/integrity-check/useIntegrityCheck')>()),
  isIntegrityCheckRunning: (...args: unknown[]) => stubs.isIntegrityCheckRunning(...args),
}))

vi.mock('@/04-features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features')>()),
  useSystemNotifications: () => ({
    sendSystemNotification: stubs.sendSystemNotification,
    startSystemNotifications: async (): Promise<void> => {},
  }),
}))

describe('useAccountsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubs.executeSteps.mockReset()
    stubs.sendSystemNotification.mockReset()
    stubs.isIntegrityCheckRunning.mockReset()
    stubs.isIntegrityCheckRunning.mockReturnValue(false)
    stubs.useRealGameLaunch = false
    streamStubs.flushLaunchSteps.mockReset()
    streamStubs.prefillLaunchSteps.mockReset()
    streamStubs.resetLaunchSteps.mockReset()
    streamStubs.flushLaunchSteps.mockResolvedValue(undefined)
    vi.mocked(authLogins).mockReset()
    vi.mocked(clearSession).mockReset()
    vi.mocked(deleteAccount).mockReset()
    vi.mocked(downloadJava).mockReset()
    vi.mocked(downloadMinecraft).mockReset()
    vi.mocked(exitLauncher).mockReset()
    vi.mocked(getGameState).mockReset()
    vi.mocked(getSessionInfo).mockReset()
    vi.mocked(initializeProject).mockReset()
    vi.mocked(loadInstallJournal).mockReset()
    vi.mocked(loadSettingsProject).mockReset()
    vi.mocked(saveCurrentProject).mockReset()
    vi.mocked(setInitialized).mockReset()
    vi.mocked(startMinecraft).mockReset()
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockResolvedValue(null)
    vi.mocked(getGameState).mockResolvedValue([])
    useCoreStore().currentProject = 'proj'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupPage = (): ReturnType<typeof useAccountsPage> => {
    const { result } = withSetup(() => useAccountsPage())
    return result
  }

  it('detects the offline launcher server only for online projects', () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig({ online: true })
    const page = setupPage()

    expect(page.isServerOffline.value).toBe(false)

    useServerStore().isServerReachable = false
    expect(page.isServerOffline.value).toBe(true)

    core.projectConfig = makeProjectConfig({ online: false })
    expect(page.isServerOffline.value).toBe(false)

    core.projectConfig = makeProjectConfig({ online: true })
    core.offlineBuild = true
    expect(page.isServerOffline.value).toBe(false)
  })

  it('blocks the launch while the launcher server is offline', async () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig({ online: true })
    useServerStore().isServerReachable = false
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('Сервер лаунчера недоступен, запуск невозможен')
    expect(stubs.sendSystemNotification).not.toHaveBeenCalled()
  })

  it('blocks the launch while a file integrity check is running', async () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig({ online: true })
    stubs.isIntegrityCheckRunning.mockReturnValue(true)
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(getGameState).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('Идёт проверка целостности, запуск невозможен')
  })

  it('blocks the launch while the current account already has a running game', async () => {
    useAccountsStore().session = { username: 'alice', uuid: 'uuid-alice' }
    useLaunchStore().gameUsernames = ['alice', 'bob']
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('Этот аккаунт уже в игре')
  })

  it('allows the launch while another account has a running game', async () => {
    useAccountsStore().session = { username: 'carol', uuid: 'uuid-carol' }
    useLaunchStore().gameUsernames = ['alice', 'bob']
    stubs.executeSteps.mockResolvedValueOnce(undefined)
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
  })

  it('blocks the launch when the backend reports a session the store missed', async () => {
    const launch = useLaunchStore()
    useAccountsStore().session = { username: 'alice', uuid: 'uuid-alice' }
    vi.mocked(getGameState).mockResolvedValue(['bob', 'alice'])
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(launch.gameUsernames).toEqual(['bob', 'alice'])
    expect(useNotificationStore().message).toBe('Этот аккаунт уже в игре')
  })

  it('blocks the launch when the session check fails', async () => {
    vi.mocked(getGameState).mockRejectedValue(new Error('ipc down'))
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('Не удалось проверить состояние игры, запуск заблокирован')
  })

  it('aborts the launch when the user leaves to the accounts view during the session check', async () => {
    let resolveState: (usernames: string[]) => void = () => {}
    vi.mocked(getGameState).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveState = resolve
        }),
    )
    const page = setupPage()

    const pending = page.handleLaunch()
    await vi.waitFor(() => expect(getGameState).toHaveBeenCalledTimes(1))
    await page.goToAccounts()
    resolveState([])
    await pending

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('')
  })

  it('re-checks the active username after the session check resolves', async () => {
    useAccountsStore().session = { username: 'alice', uuid: 'uuid-alice' }
    let resolveState: (usernames: string[]) => void = () => {}
    vi.mocked(getGameState).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveState = resolve
        }),
    )
    stubs.executeSteps.mockResolvedValueOnce(undefined)
    const page = setupPage()

    const pending = page.handleLaunch()
    await vi.waitFor(() => expect(getGameState).toHaveBeenCalledTimes(1))
    useAccountsStore().session = { username: 'bob', uuid: 'uuid-bob' }
    resolveState(['alice'])
    await pending

    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
  })

  it('applies the fresh session list even when the launch proceeds', async () => {
    useLaunchStore().gameUsernames = ['ghost']
    vi.mocked(getGameState).mockResolvedValue(['carol'])
    stubs.executeSteps.mockResolvedValueOnce(undefined)
    const page = setupPage()

    await page.handleLaunch()

    expect(useLaunchStore().gameUsernames).toEqual(['carol'])
    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
  })

  it('returns to the accounts view and restores the session screen on the next launch', async () => {
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice']
    const page = setupPage()

    await page.dismissSessionView()
    expect(page.sessionViewDismissed.value).toBe(true)
    expect(launch.sessionViewDismissed).toBe(true)

    launch.gameUsernames = []
    stubs.executeSteps.mockResolvedValueOnce(undefined)
    await page.handleLaunch()

    expect(page.sessionViewDismissed.value).toBe(false)
  })

  it('re-syncs the ghost session when leaving the session screen', async () => {
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice']
    vi.mocked(getGameState).mockResolvedValue([])
    const page = setupPage()

    await page.dismissSessionView()

    expect(launch.gameUsernames).toEqual([])
    expect(launch.sessionViewDismissed).toBe(true)
  })

  it('keeps the running session when the backend confirms it after dismissing', async () => {
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice']
    vi.mocked(getGameState).mockResolvedValue(['alice'])
    const page = setupPage()

    await page.dismissSessionView()

    expect(launch.gameUsernames).toEqual(['alice'])
  })

  it('blocks the launch while a project switch is in flight', async () => {
    const core = useCoreStore()
    core.projects = ['proj', 'beta']
    let releaseSwitch: () => void = () => {}
    vi.mocked(saveCurrentProject).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSwitch = resolve
        }),
    )
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig({ online: true }))
    vi.mocked(authLogins).mockResolvedValue([])
    const projectSwitch = useProjectSwitch()
    const pendingSwitch = projectSwitch.selectProject('beta')
    await vi.waitFor(() => expect(projectSwitch.isSwitching.value).toBe(true))

    const page = setupPage()
    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(getGameState).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('Идёт переключение проекта, запуск невозможен')

    releaseSwitch()
    await pendingSwitch
  })

  it('runs the launch pipeline and clears the launching flag', async () => {
    let releaseSteps: () => void = () => {}
    stubs.executeSteps.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSteps = resolve
        }),
    )
    const page = setupPage()

    const pending = page.handleLaunch()
    await vi.waitFor(() => expect(useLaunchStore().isLaunching).toBe(true))
    releaseSteps()
    await pending

    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().isCancelPending).toBe(false)
    expect(useLaunchStore().loginError).toBe('')
  })

  it('surfaces the pipeline failure through the login error', async () => {
    stubs.executeSteps.mockRejectedValue(new Error('java missing'))
    const page = setupPage()

    await page.handleLaunch()

    expect(useLaunchStore().loginError).toBe('java missing')
    expect(useLaunchStore().isLaunching).toBe(false)
  })

  it('ignores a parallel second launch while the session check is pending', async () => {
    const resolveSessionChecks: Array<(usernames: string[]) => void> = []
    vi.mocked(getGameState).mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveSessionChecks.push(resolve)
        }),
    )
    const page = setupPage()

    const first = page.handleLaunch()
    const second = page.handleLaunch()
    for (const resolve of resolveSessionChecks) resolve([])
    await Promise.all([first, second])

    expect(getGameState).toHaveBeenCalledTimes(2)
    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
  })

  it('ignores a repeated launch while one is running', async () => {
    let releaseSteps: () => void = () => {}
    stubs.executeSteps.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSteps = resolve
        }),
    )
    const page = setupPage()

    const first = page.handleLaunch()
    await vi.waitFor(() => expect(useLaunchStore().isLaunching).toBe(true))
    await page.handleLaunch()

    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
    releaseSteps()
    await first
  })

  it('finalizes the cancellation on the way back to the accounts', async () => {
    let releaseSteps: () => void = () => {}
    stubs.executeSteps.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSteps = resolve
        }),
    )
    vi.mocked(clearSession).mockResolvedValue(undefined)
    const page = setupPage()
    useAccountsStore().selectedUsername = 'alice'

    const pending = page.handleLaunch()
    await vi.waitFor(() => expect(useLaunchStore().isLaunching).toBe(true))
    await page.goToAccounts()
    expect(useLaunchStore().isCancelPending).toBe(true)

    releaseSteps()
    await pending

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().isCancelPending).toBe(false)
    expect(useLaunchStore().loginError).toBe('')
    expect(useAccountsStore().showAuthForm).toBe(false)
    expect(useAccountsStore().isLoggedIn).toBe(false)
    expect(useAccountsStore().selectedUsername).toBe('')
  })

  describe('with the real launch pipeline', () => {
    it('keeps the running game session when the cancel lands during install finalization', async () => {
      stubs.useRealGameLaunch = true
      vi.mocked(initializeProject).mockResolvedValue(
        makeProjectConfig({ online: false, initialized: false }),
      )
      vi.mocked(loadInstallJournal).mockResolvedValue([])
      let releaseInitialized: (config: ProjectConfig) => void = () => {}
      vi.mocked(setInitialized).mockImplementation(
        () =>
          new Promise<ProjectConfig>((resolve) => {
            releaseInitialized = resolve
          }),
      )
      const page = setupPage()

      const pending = page.handleLaunch()
      await vi.waitFor(() => expect(setInitialized).toHaveBeenCalledTimes(1))
      await page.goToAccounts()
      expect(useLaunchStore().isCancelPending).toBe(false)
      expect(clearSession).not.toHaveBeenCalled()

      releaseInitialized(makeProjectConfig({ online: false, initialized: true }))
      await pending

      expect(startMinecraft).toHaveBeenCalledTimes(1)
      expect(clearSession).not.toHaveBeenCalled()
      expect(useLaunchStore().isLaunching).toBe(false)
      expect(useLaunchStore().isLaunchCommitted).toBe(true)
      expect(useCoreStore().projectConfig?.initialized).toBe(true)
    })

    it('keeps the running game session when the cancel lands during the step flush', async () => {
      stubs.useRealGameLaunch = true
      vi.mocked(initializeProject).mockResolvedValue(
        makeProjectConfig({ online: false, initialized: true }),
      )
      let releaseFlush: () => void = () => {}
      streamStubs.flushLaunchSteps.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFlush = resolve
          }),
      )
      const page = setupPage()

      const pending = page.handleLaunch()
      await vi.waitFor(() => expect(streamStubs.flushLaunchSteps).toHaveBeenCalledTimes(1))
      await page.goToAccounts()
      expect(useLaunchStore().isCancelPending).toBe(false)

      releaseFlush()
      await pending

      expect(startMinecraft).toHaveBeenCalledTimes(1)
      expect(clearSession).not.toHaveBeenCalled()
      expect(useLaunchStore().isLaunching).toBe(false)
    })

    it('keeps the session when the launch completes after a cancel during the process start', async () => {
      stubs.useRealGameLaunch = true
      vi.mocked(initializeProject).mockResolvedValue(
        makeProjectConfig({ online: false, initialized: true }),
      )
      let releaseStart: () => void = () => {}
      vi.mocked(startMinecraft).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseStart = resolve
          }),
      )
      const page = setupPage()

      const pending = page.handleLaunch()
      await vi.waitFor(() => expect(startMinecraft).toHaveBeenCalledTimes(1))
      await page.goToAccounts()
      expect(useLaunchStore().isCancelPending).toBe(true)

      releaseStart()
      await pending

      expect(clearSession).not.toHaveBeenCalled()
      expect(useLaunchStore().isCancelPending).toBe(false)
      expect(useLaunchStore().isLaunching).toBe(false)
    })

    it('finalizes the cancellation before the game process starts', async () => {
      stubs.useRealGameLaunch = true
      vi.mocked(initializeProject).mockResolvedValue(
        makeProjectConfig({ online: false, initialized: false }),
      )
      vi.mocked(loadInstallJournal).mockResolvedValue([])
      let releaseJava: () => void = () => {}
      vi.mocked(downloadJava).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseJava = resolve
          }),
      )
      useAccountsStore().selectedUsername = 'alice'
      const page = setupPage()

      const pending = page.handleLaunch()
      await vi.waitFor(() => expect(downloadJava).toHaveBeenCalledTimes(1))
      await page.goToAccounts()
      expect(useLaunchStore().isCancelPending).toBe(true)

      releaseJava()
      await pending

      expect(startMinecraft).not.toHaveBeenCalled()
      expect(clearSession).toHaveBeenCalledTimes(1)
      expect(useLaunchStore().isLaunching).toBe(false)
      expect(useAccountsStore().showAuthForm).toBe(false)
      expect(useAccountsStore().selectedUsername).toBe('')
    })
  })

  it('shows the auth form instead of cancelling an idle page', async () => {
    const accounts = useAccountsStore()
    accounts.showAuthForm = true
    accounts.loginFormData.password = 'secret'
    const page = setupPage()

    await page.goToAccounts()

    expect(accounts.showAuthForm).toBe(false)
    expect(accounts.loginFormData.password).toBe('')
    expect(clearSession).not.toHaveBeenCalled()
  })

  it('deletes the account after confirmation and clears the active session', async () => {
    const accountsStore = useAccountsStore()
    accountsStore.session = { uuid: 'u-1', username: 'alice' }
    vi.mocked(deleteAccount).mockResolvedValue(undefined)
    vi.mocked(clearSession).mockResolvedValue(undefined)
    vi.mocked(authLogins).mockResolvedValue([])
    const page = setupPage()

    const pending = page.handleDeleteAccount('alice')
    useNotificationStore().resolvePopup(true)
    await pending

    expect(deleteAccount).toHaveBeenCalledWith('proj', 'alice')
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(accountsStore.session).toBeNull()
    expect(accountsStore.isLoggedIn).toBe(false)
    expect(useAccountsStore().selectedUsername).toBe('')
    expect(useNotificationStore().message).toBe('Аккаунт удалён')
  })

  it('keeps the switched project session when the project changes while the deletion is in flight', async () => {
    const core = useCoreStore()
    const accountsStore = useAccountsStore()
    accountsStore.session = { uuid: 'u-old', username: 'alice' }
    accountsStore.selectedUsername = 'alice'
    vi.mocked(authLogins).mockResolvedValue([])
    let switchDuringDelete: () => void = () => {}
    vi.mocked(deleteAccount).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          switchDuringDelete = (): void => {
            core.currentProject = 'beta'
            accountsStore.session = { uuid: 'u-new', username: 'alice' }
            resolve()
          }
        }),
    )
    const page = setupPage()

    const pending = page.handleDeleteAccount('alice')
    useNotificationStore().resolvePopup(true)
    await vi.waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1))
    const loginsCallsBefore = vi.mocked(authLogins).mock.calls.length
    switchDuringDelete()
    await pending

    expect(deleteAccount).toHaveBeenCalledWith('proj', 'alice')
    expect(clearSession).not.toHaveBeenCalled()
    expect(accountsStore.session).toEqual({ uuid: 'u-new', username: 'alice' })
    expect(accountsStore.isLoggedIn).toBe(true)
    expect(accountsStore.selectedUsername).toBe('alice')
    expect(vi.mocked(authLogins).mock.calls.length).toBe(loginsCallsBefore)
    expect(useNotificationStore().message).toBe('')
  })

  it('keeps the account when the confirmation is declined', async () => {
    const page = setupPage()

    const pending = page.handleDeleteAccount('alice')
    useNotificationStore().resolvePopup(false)
    await pending

    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('shows the deletion error', async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new Error('account busy'))
    const page = setupPage()

    const pending = page.handleDeleteAccount('alice')
    useNotificationStore().resolvePopup(true)
    await pending

    expect(useNotificationStore().message).toBe('account busy')
  })

  it('derives the scene username with the session priority', () => {
    const accounts = useAccountsStore()
    accounts.logins = ['alice', 'bob']
    const page = setupPage()

    expect(page.sceneUsername.value).toBe('alice')

    accounts.selectedUsername = 'bob'
    expect(page.sceneUsername.value).toBe('bob')

    accounts.session = { uuid: 'u-1', username: 'carol' }
    expect(page.sceneUsername.value).toBe('carol')
  })

  it('shows the auth form for a fresh project without accounts', async () => {
    const page = setupPage()
    await vi.waitFor(() => expect(useAccountsStore().isLoginsLoading).toBe(false))

    expect(page.showAuth.value).toBe(true)

    useAccountsStore().logins = ['alice']
    expect(page.showAuth.value).toBe(false)
    expect(page.showBack.value).toBe(true)
  })
})
