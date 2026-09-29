import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { authLogins, clearSession, deleteAccount, getSessionInfo } from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
} from '@/05-entities'
import { useAccountsPage } from './useAccountsPage'
import { withSetup } from '@/test-support/withSetup'

const stubs = vi.hoisted(() => ({
  executeSteps: vi.fn(),
  sendSystemNotification: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
  clearSession: vi.fn(),
  deleteAccount: vi.fn(),
  getSessionInfo: vi.fn(),
}))

vi.mock('@/04-features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features')>()),
  useGameLaunch: () => ({
    launchSteps: computed((): [] => []),
    activeProgress: computed((): number => 0),
    executeSteps: stubs.executeSteps,
  }),
  useSystemNotifications: () => ({
    sendSystemNotification: stubs.sendSystemNotification,
    startSystemNotifications: async (): Promise<void> => {},
  }),
}))

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
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

describe('useAccountsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubs.executeSteps.mockReset()
    stubs.sendSystemNotification.mockReset()
    vi.mocked(authLogins).mockReset()
    vi.mocked(clearSession).mockReset()
    vi.mocked(deleteAccount).mockReset()
    vi.mocked(getSessionInfo).mockReset()
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockResolvedValue(null)
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
    core.projectConfig = makeProjectConfig(true)
    const page = setupPage()

    expect(page.isServerOffline.value).toBe(false)

    core.isServerReachable = false
    expect(page.isServerOffline.value).toBe(true)

    core.projectConfig = makeProjectConfig(false)
    expect(page.isServerOffline.value).toBe(false)

    core.projectConfig = makeProjectConfig(true)
    core.offlineBuild = true
    expect(page.isServerOffline.value).toBe(false)
  })

  it('blocks the launch while the launcher server is offline', async () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig(true)
    core.isServerReachable = false
    const page = setupPage()

    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(useAccountsStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe('Сервер лаунчера недоступен, запуск невозможен')
    expect(stubs.sendSystemNotification).toHaveBeenCalledWith(
      'Запуск заблокирован',
      'Сервер лаунчера недоступен',
    )
  })

  it('runs the launch pipeline and clears the launching flag', async () => {
    stubs.executeSteps.mockResolvedValue(undefined)
    const page = setupPage()

    const pending = page.handleLaunch()
    expect(useAccountsStore().isLaunching).toBe(true)
    await pending

    expect(stubs.executeSteps).toHaveBeenCalledTimes(1)
    expect(useAccountsStore().isLaunching).toBe(false)
    expect(useAccountsStore().isCancelPending).toBe(false)
    expect(useAccountsStore().loginError).toBe('')
  })

  it('surfaces the pipeline failure through the login error', async () => {
    stubs.executeSteps.mockRejectedValue(new Error('java missing'))
    const page = setupPage()

    await page.handleLaunch()

    expect(useAccountsStore().loginError).toBe('java missing')
    expect(useAccountsStore().isLaunching).toBe(false)
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

    const pending = page.handleLaunch()
    await page.goToAccounts()
    expect(useAccountsStore().isCancelPending).toBe(true)

    releaseSteps()
    await pending

    expect(clearSession).toHaveBeenCalledTimes(1)
    const accounts = useAccountsStore()
    expect(accounts.isLaunching).toBe(false)
    expect(accounts.isCancelPending).toBe(false)
    expect(accounts.showAuthForm).toBe(false)
    expect(useCoreStore().isLoggedIn).toBe(false)
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
    const core = useCoreStore()
    core.session = { uuid: 'u-1', username: 'alice' }
    core.isLoggedIn = true
    vi.mocked(deleteAccount).mockResolvedValue(undefined)
    vi.mocked(clearSession).mockResolvedValue(undefined)
    vi.mocked(authLogins).mockResolvedValue([])
    const page = setupPage()

    const pending = page.handleDeleteAccount('alice')
    useNotificationStore().resolvePopup(true)
    await pending

    expect(deleteAccount).toHaveBeenCalledWith('proj', 'alice')
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(core.session).toBeNull()
    expect(core.isLoggedIn).toBe(false)
    expect(useAccountsStore().selectedUsername).toBe('')
    expect(useNotificationStore().message).toBe('Аккаунт удалён')
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
    const core = useCoreStore()
    const accounts = useAccountsStore()
    accounts.logins = ['alice', 'bob']
    const page = setupPage()

    expect(page.sceneUsername.value).toBe('alice')

    accounts.selectedUsername = 'bob'
    expect(page.sceneUsername.value).toBe('bob')

    core.session = { uuid: 'u-1', username: 'carol' }
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
