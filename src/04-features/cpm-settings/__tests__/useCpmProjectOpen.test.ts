import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, type LauncherConfig } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}))

const api = vi.hoisted(() => ({
  listenCpmProjectOpen: vi.fn(),
  takeCpmProjectPath: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: (): { replace: (route: unknown) => void; push: (route: unknown) => void } => router,
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listenCpmProjectOpen: api.listenCpmProjectOpen,
  takeCpmProjectPath: api.takeCpmProjectPath,
}))

const makeLauncherConfig = (): LauncherConfig => ({
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
  projectNames: ['proj'],
  currentProject: 'proj',
  projects: {},
})

describe('useCpmProjectOpen', () => {
  let emitOpen: ((path: string) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    emitOpen = undefined
    router.replace.mockReset()
    router.push.mockReset()
    api.listenCpmProjectOpen.mockReset()
    api.takeCpmProjectPath.mockReset()
    api.listenCpmProjectOpen.mockImplementation(async (handler: (path: string) => void) => {
      emitOpen = handler
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const runSync = async (): Promise<void> => {
    const { useCpmProjectOpen } = await import('../useCpmProjectOpen')
    const { unmount } = withSetup(() => useCpmProjectOpen())
    unmount()
  }

  it('picks the pending path from the launch args', async () => {
    api.takeCpmProjectPath.mockResolvedValue('/models/hero.cpmproject')
    useCoreStore().launcherConfig = null

    await runSync()

    expect(useCoreStore().pendingCpmProjectPath).toBe('/models/hero.cpmproject')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('routes to the model settings once the launcher config appears', async () => {
    api.takeCpmProjectPath.mockResolvedValue('/models/hero.cpmproject')
    useCoreStore().launcherConfig = null
    const { unmount } = await (async (): Promise<{ unmount: () => void }> => {
      const { useCpmProjectOpen } = await import('../useCpmProjectOpen')
      return withSetup(() => useCpmProjectOpen())
    })()
    await vi.waitFor(() => expect(useCoreStore().pendingCpmProjectPath).not.toBeNull())
    expect(router.push).not.toHaveBeenCalled()

    useCoreStore().launcherConfig = makeLauncherConfig()
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith({ name: 'SettingsModel' }))

    unmount()
  })

  it('stays idle when there is no pending model', async () => {
    api.takeCpmProjectPath.mockResolvedValue(null)
    useCoreStore().launcherConfig = makeLauncherConfig()

    await runSync()

    expect(useCoreStore().pendingCpmProjectPath).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('receives the model path through the live event', async () => {
    api.takeCpmProjectPath.mockResolvedValue(null)
    useCoreStore().launcherConfig = makeLauncherConfig()

    await runSync()

    expect(emitOpen).toBeDefined()
    emitOpen?.('/models/live.cpmproject')

    expect(useCoreStore().pendingCpmProjectPath).toBe('/models/live.cpmproject')
  })

  it('reports the launch-args failure and still subscribes', async () => {
    api.takeCpmProjectPath.mockRejectedValue(new Error('ipc down'))

    await runSync()
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        'Не удалось получить модель из аргументов запуска',
        expect.any(Error),
      ),
    )

    expect(api.listenCpmProjectOpen).toHaveBeenCalledTimes(1)
    expect(useCoreStore().pendingCpmProjectPath).toBeNull()
  })

  it('allows a retry when the subscription fails', async () => {
    api.takeCpmProjectPath.mockResolvedValue(null)
    api.listenCpmProjectOpen.mockRejectedValueOnce(new Error('no bus'))

    await runSync()
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        'Не удалось подписаться на открытие файла модели',
        expect.any(Error),
      ),
    )

    await runSync()
    await vi.waitFor(() => expect(api.listenCpmProjectOpen).toHaveBeenCalledTimes(2))
  })

  it('starts the sync only once', async () => {
    api.takeCpmProjectPath.mockResolvedValue(null)
    const { useCpmProjectOpen } = await import('../useCpmProjectOpen')

    const { unmount } = withSetup(() => useCpmProjectOpen())
    unmount()
    const { unmount: unmountAgain } = withSetup(() => useCpmProjectOpen())
    unmountAgain()

    expect(api.takeCpmProjectPath).toHaveBeenCalledTimes(1)
  })
})
