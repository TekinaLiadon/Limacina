import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { authLogins, clearSession, deleteAccount, getGameState, getSessionInfo, loadSettingsProject, saveCurrentProject } from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useLaunchStore,
  useNotificationStore,
  useServerStore,
  type CPMAnimation,
  type CPMData,
} from '@/05-entities'
import { useAccountsPage } from '../useAccountsPage'
import { useProjectSwitch } from '@/04-features/project-switch/useProjectSwitch'
import { useCpmAnimationEditor } from '@/04-features/cpm-animation-editor/useCpmAnimationEditor'
import { createCpmEditorBridge } from '@/04-features/cpm-viewer/cpmEditorBridge'
import { withSetup } from '@/test-support/withSetup'
import { makeProjectConfig } from '@/test-support/fixtures'

const stubs = vi.hoisted(() => ({
  executeSteps: vi.fn(),
  sendSystemNotification: vi.fn(),
  isIntegrityCheckRunning: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogins: vi.fn(),
  clearSession: vi.fn(),
  deleteAccount: vi.fn(),
  getGameState: vi.fn(),
  getSessionInfo: vi.fn(),
  listenGameExit: vi.fn(async (): Promise<() => void> => () => {}),
  listenGameStarted: vi.fn(async (): Promise<() => void> => () => {}),
  loadSettingsProject: vi.fn(),
  saveCurrentProject: vi.fn(),
}))

vi.mock('@/04-features/game-launch/useGameLaunch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features/game-launch/useGameLaunch')>()),
  useGameLaunch: () => ({
    launchSteps: computed((): [] => []),
    activeProgress: computed((): number => 0),
    executeSteps: stubs.executeSteps,
  }),
}))

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
    vi.mocked(authLogins).mockReset()
    vi.mocked(clearSession).mockReset()
    vi.mocked(deleteAccount).mockReset()
    vi.mocked(getGameState).mockReset()
    vi.mocked(getSessionInfo).mockReset()
    vi.mocked(loadSettingsProject).mockReset()
    vi.mocked(saveCurrentProject).mockReset()
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

  it('blocks the launch while the animation editor has unsaved changes', async () => {
    const pinia = getActivePinia()
    if (!pinia) throw new Error('pinia is not active')
    const animation: CPMAnimation = {
      id: 'g_wave.json',
      name: 'Машет',
      kind: 'gesture',
      duration: 1000,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'linear_loop',
      hidden: false,
      frames: Array.from({ length: 6 }, () => ({ components: [] })),
    }
    const data = shallowRef<CPMData | null>(null)
    const { result: editor, unmount } = withSetup(() => useCpmAnimationEditor({
      data,
      projectBytes: ref<Uint8Array | null>(null),
      bridge: createCpmEditorBridge(),
    }), [pinia])

    data.value = {
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [{
          id: 'head',
          name: 'Head',
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        }],
      },
      textureUrl: 'blob:model',
      animations: [animation],
    }
    await nextTick()
    editor.startEditing('g_wave.json')
    editor.setBoneRotation('y', 30)

    const page = setupPage()
    await page.handleLaunch()

    expect(stubs.executeSteps).not.toHaveBeenCalled()
    expect(getGameState).not.toHaveBeenCalled()
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useNotificationStore().message).toBe(
      'В редакторе анимаций есть несохранённые изменения, запуск игры заблокирован',
    )

    unmount()
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
    accountsStore.isLoggedIn = true
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
