import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, type LauncherConfig } from '@/05-entities'
import { makeProjectConfig } from '@/test-support/fixtures'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/04-features/setup/useOfflineSetup', () => ({
  startOfflineSetupRedirect: vi.fn(),
}))

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  currentRoute: { name: 'Accounts' as string | undefined },
}))

vi.mock('vue-router', () => ({
  useRouter: (): unknown => router,
  useRoute: (): unknown => router.currentRoute,
}))

const makeLauncherConfig = (overrides: Partial<LauncherConfig> = {}): LauncherConfig => ({
  launcherPath: '/games/limacina',
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
  ...overrides,
})

describe('useAppNavigation', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    router.push.mockClear()
    router.replace.mockClear()
    router.currentRoute.name = 'Accounts'
    const { startOfflineSetupRedirect } = await import('@/04-features/setup/useOfflineSetup')
    vi.mocked(startOfflineSetupRedirect).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupNavigation = async (): Promise<ReturnType<typeof import('../useAppNavigation')['useAppNavigation']>> => {
    const { useAppNavigation } = await import('../useAppNavigation')
    const { result } = withSetup(() => useAppNavigation())
    await nextTick()
    return result
  }

  it('wires the offline setup redirect once on setup', async () => {
    const { startOfflineSetupRedirect } = await import('@/04-features/setup/useOfflineSetup')

    await setupNavigation()

    expect(startOfflineSetupRedirect).toHaveBeenCalledOnce()
  })

  it('redirects an online project away from Mods immediately', async () => {
    const core = useCoreStore()
    core.setProjectConfig(makeProjectConfig({ online: true }))
    router.currentRoute.name = 'Mods'

    await setupNavigation()

    expect(router.push).toHaveBeenCalledWith({ name: 'Accounts' })
  })

  it('keeps Mods open for an offline project', async () => {
    const core = useCoreStore()
    core.setProjectConfig(makeProjectConfig({ online: false }))
    router.currentRoute.name = 'Mods'

    await setupNavigation()

    expect(router.push).not.toHaveBeenCalled()
  })

  it('does not redirect from Mods when the route name is unknown', async () => {
    const core = useCoreStore()
    core.setProjectConfig(makeProjectConfig({ online: true }))
    router.currentRoute.name = undefined

    await setupNavigation()

    expect(router.push).not.toHaveBeenCalled()
  })

  it('leaves other routes alone while the project is online', async () => {
    const core = useCoreStore()
    core.setProjectConfig(makeProjectConfig({ online: true }))
    router.currentRoute.name = 'Accounts'

    await setupNavigation()

    expect(router.push).not.toHaveBeenCalled()
  })

  it('redirects when the project switches from offline to online while on Mods', async () => {
    const core = useCoreStore()
    core.setProjectConfig(makeProjectConfig({ online: false }))
    router.currentRoute.name = 'Mods'

    await setupNavigation()
    expect(router.push).not.toHaveBeenCalled()

    core.setProjectConfig(makeProjectConfig({ online: true }))
    await nextTick()

    expect(router.push).toHaveBeenCalledWith({ name: 'Accounts' })
  })

  it('does not redirect when the project becomes offline while on Mods', async () => {
    const core = useCoreStore()
    core.setProjectConfig(makeProjectConfig({ online: true }))
    router.currentRoute.name = 'Accounts'

    await setupNavigation()
    router.currentRoute.name = 'Mods'

    core.setProjectConfig(makeProjectConfig({ online: false }))
    await nextTick()

    expect(router.push).not.toHaveBeenCalled()
  })

  it('hides the debug tab when the launcher config has no debug mode', async () => {
    const { isDebugTabVisible } = await setupNavigation()

    expect(isDebugTabVisible.value).toBe(false)
  })

  it('shows the debug tab only when debug mode is enabled', async () => {
    const core = useCoreStore()
    core.setLauncherConfig(makeLauncherConfig({ debugMode: true }))

    const { isDebugTabVisible } = await setupNavigation()

    expect(isDebugTabVisible.value).toBe(true)
  })

  it('redirects from Debug immediately when debug mode is off', async () => {
    const core = useCoreStore()
    core.setLauncherConfig(makeLauncherConfig({ debugMode: false }))
    router.currentRoute.name = 'Debug'

    await setupNavigation()

    expect(router.push).toHaveBeenCalledWith({ name: 'Accounts' })
  })

  it('keeps Debug open while debug mode is on', async () => {
    const core = useCoreStore()
    core.setLauncherConfig(makeLauncherConfig({ debugMode: true }))
    router.currentRoute.name = 'Debug'

    await setupNavigation()

    expect(router.push).not.toHaveBeenCalled()
  })

  it('redirects from Debug when debug mode turns off', async () => {
    const core = useCoreStore()
    core.setLauncherConfig(makeLauncherConfig({ debugMode: true }))
    router.currentRoute.name = 'Debug'

    await setupNavigation()
    expect(router.push).not.toHaveBeenCalled()

    core.patchLauncherConfig({ debugMode: false })
    await nextTick()

    expect(router.push).toHaveBeenCalledWith({ name: 'Accounts' })
  })

  it('does not redirect from other routes when debug mode turns off', async () => {
    const core = useCoreStore()
    core.setLauncherConfig(makeLauncherConfig({ debugMode: true }))
    router.currentRoute.name = 'Accounts'

    await setupNavigation()

    core.patchLauncherConfig({ debugMode: false })
    await nextTick()

    expect(router.push).not.toHaveBeenCalled()
  })
})
