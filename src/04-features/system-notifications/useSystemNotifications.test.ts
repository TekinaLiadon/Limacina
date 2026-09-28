import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationStore, type GameExitInfo } from '@/05-entities'

const api = vi.hoisted(() => ({
  listenLaunchSteps: vi.fn(),
  listenGameExit: vi.fn(),
  getNotificationIcon: vi.fn(),
  sendOsNotification: vi.fn(),
  isNotificationPermissionGranted: vi.fn(),
  requestNotificationPermission: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listenLaunchSteps: api.listenLaunchSteps,
  listenGameExit: api.listenGameExit,
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

const exitInfo = (overrides: Partial<GameExitInfo>): GameExitInfo => ({
  success: false,
  code: 1,
  reason: null,
  ...overrides,
})

describe('useSystemNotifications game exit', () => {
  let emitExit: ((info: GameExitInfo) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    windowApi.minimized = false
    api.listenLaunchSteps.mockReset()
    api.listenGameExit.mockReset()
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const start = async (): Promise<void> => {
    const notifications = await loadNotifications()
    await notifications.startSystemNotifications()
  }

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

  it('ignores successful exits', async () => {
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
})
