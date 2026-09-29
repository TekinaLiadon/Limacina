import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, useNotificationStore, type GameExitInfo, type LauncherConfig } from '@/05-entities'

const api = vi.hoisted(() => ({
  listenLaunchSteps: vi.fn(),
  listenGameExit: vi.fn(),
  listenGameStarted: vi.fn(),
  getNotificationIcon: vi.fn(),
  sendOsNotification: vi.fn(),
  isNotificationPermissionGranted: vi.fn(),
  requestNotificationPermission: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listenLaunchSteps: api.listenLaunchSteps,
  listenGameExit: api.listenGameExit,
  listenGameStarted: api.listenGameStarted,
  getNotificationIcon: api.getNotificationIcon,
}))

vi.mock('@/06-shared/utils/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/utils/notifications')>()),
  sendOsNotification: api.sendOsNotification,
  isNotificationPermissionGranted: api.isNotificationPermissionGranted,
  requestNotificationPermission: api.requestNotificationPermission,
}))

const windowApi = vi.hoisted(() => ({
  minimized: false,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMinimized: async () => windowApi.minimized,
  }),
}))

interface NotificationsApi {
  startSystemNotifications: () => Promise<void>
}

const loadNotifications = async (): Promise<NotificationsApi> => {
  const { useSystemNotifications } = await import('./useSystemNotifications')
  return useSystemNotifications()
}

const makeLauncherConfig = (systemNotifications: boolean): LauncherConfig => ({
  launcherPath: '',
  installId: null,
  discordActivity: false,
  keepOldConfigs: true,
  downloadSpeedLimit: null,
  autoUpdate: false,
  systemNotifications,
  debugMode: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: true,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames: ['proj'],
  currentProject: 'proj',
  projects: {},
})

const exitInfo = (overrides: Partial<GameExitInfo>): GameExitInfo => ({
  success: false,
  code: 1,
  reason: null,
  ...overrides,
})

const setVisibility = (state: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useSystemNotifications', () => {
  let emitExit: ((info: GameExitInfo) => void) | undefined
  let emitStarted: ((username: string) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    windowApi.minimized = false
    emitExit = undefined
    emitStarted = undefined
    api.listenLaunchSteps.mockReset()
    api.listenGameExit.mockReset()
    api.listenGameStarted.mockReset()
    api.getNotificationIcon.mockReset()
    api.sendOsNotification.mockReset()
    api.isNotificationPermissionGranted.mockReset()
    api.requestNotificationPermission.mockReset()
    api.getNotificationIcon.mockResolvedValue(null)
    api.isNotificationPermissionGranted.mockResolvedValue(true)
    api.listenLaunchSteps.mockResolvedValue(() => {})
    api.listenGameExit.mockImplementation(async (handler: (info: GameExitInfo) => void) => {
      emitExit = handler
      return () => {}
    })
    api.listenGameStarted.mockImplementation(async (handler: (username: string) => void) => {
      emitStarted = handler
      return () => {}
    })
  })

  afterEach(() => {
    setVisibility('visible')
    vi.restoreAllMocks()
  })

  const start = async (): Promise<void> => {
    const notifications = await loadNotifications()
    await notifications.startSystemNotifications()
  }

  describe('game exit', () => {
    it('shows the backend reason as a toast', async () => {
      await start()
      const notification = useNotificationStore()

      await emitExit?.(exitInfo({ reason: 'Недостаточно выделенной памяти (OutOfMemoryError)' }))

      expect(notification.visible).toBe(true)
      expect(notification.message).toBe('Недостаточно выделенной памяти (OutOfMemoryError)')
    })

    it('keeps the generic code message when no reason is reported', async () => {
      await start()
      const notification = useNotificationStore()

      await emitExit?.(exitInfo({ code: 1 }))

      expect(notification.visible).toBe(true)
      expect(notification.message).toBe('Игра завершилась с ошибкой (код 1)')
    })

    it('ignores successful exits while the window is visible', async () => {
      await start()
      const notification = useNotificationStore()

      await emitExit?.(exitInfo({ success: true, code: 0 }))

      expect(notification.visible).toBe(false)
      expect(api.sendOsNotification).not.toHaveBeenCalled()
    })

    it('sends an OS notification with the reason while the window is hidden', async () => {
      windowApi.minimized = true
      await start()
      const notification = useNotificationStore()

      await emitExit?.(exitInfo({ reason: 'Недостаточно выделенной памяти (OutOfMemoryError)' }))

      expect(api.sendOsNotification).toHaveBeenCalledWith({
        title: 'Игра завершилась с ошибкой',
        body: 'Недостаточно выделенной памяти (OutOfMemoryError)',
      })
      expect(notification.visible).toBe(false)
    })

    it('falls back to the code body in OS notifications without a reason', async () => {
      windowApi.minimized = true
      await start()

      await emitExit?.(exitInfo({ code: -1 }))

      expect(api.sendOsNotification).toHaveBeenCalledWith({
        title: 'Игра завершилась с ошибкой',
        body: 'Процесс игры завершился с кодом -1',
      })
    })

    it('notifies about a successful exit while the window is hidden', async () => {
      windowApi.minimized = true
      await start()

      await emitExit?.(exitInfo({ success: true, code: 0 }))

      expect(api.sendOsNotification).toHaveBeenCalledWith({
        title: 'Игра завершена',
        body: 'Игра закрыта — лаунчер ждёт в трее',
      })
    })
  })

  describe('game start', () => {
    it('sends the start notification immediately when the window is already hidden', async () => {
      windowApi.minimized = true
      await start()

      await emitStarted?.('alice')

      expect(api.sendOsNotification).toHaveBeenCalledWith({
        title: 'Игра запущена',
        body: 'Сессия alice запущена — лаунчер ждёт в трее',
      })
    })

    it('sends the start notification when the window hides after the launch', async () => {
      await start()

      await emitStarted?.('alice')
      expect(api.sendOsNotification).not.toHaveBeenCalled()

      setVisibility('hidden')

      await vi.waitFor(() =>
        expect(api.sendOsNotification).toHaveBeenCalledWith({
          title: 'Игра запущена',
          body: 'Сессия alice запущена — лаунчер ждёт в трее',
        })
      )
    })

    it('sends only one start notification per session', async () => {
      await start()

      await emitStarted?.('alice')
      setVisibility('hidden')
      await vi.waitFor(() => expect(api.sendOsNotification).toHaveBeenCalledTimes(1))

      setVisibility('visible')
      setVisibility('hidden')
      await vi.waitFor(() => expect(api.sendOsNotification).toHaveBeenCalledTimes(1))
    })

    it('notifies again on the next launch', async () => {
      await start()

      await emitStarted?.('alice')
      setVisibility('hidden')
      await vi.waitFor(() => expect(api.sendOsNotification).toHaveBeenCalledTimes(1))

      setVisibility('visible')
      await emitExit?.(exitInfo({ success: true, code: 0 }))
      await emitStarted?.('alice')
      setVisibility('hidden')

      await vi.waitFor(() => expect(api.sendOsNotification).toHaveBeenCalledTimes(2))
      expect(api.sendOsNotification).toHaveBeenLastCalledWith({
        title: 'Игра запущена',
        body: 'Сессия alice запущена — лаунчер ждёт в трее',
      })
    })

    it('does not notify after the session ended before the window hides', async () => {
      await start()

      await emitStarted?.('alice')
      await emitExit?.(exitInfo({ success: true, code: 0 }))
      setVisibility('hidden')
      await vi.waitFor(() => expect(api.sendOsNotification).not.toHaveBeenCalled())
    })

    it('sends nothing when system notifications are disabled', async () => {
      useCoreStore().launcherConfig = makeLauncherConfig(false)
      windowApi.minimized = true
      await start()

      await emitStarted?.('alice')
      await emitExit?.(exitInfo({ success: true, code: 0 }))

      expect(api.sendOsNotification).not.toHaveBeenCalled()
    })
  })
})
