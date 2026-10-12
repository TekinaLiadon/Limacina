import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, type LauncherConfig } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  currentRoute: { name: 'Accounts' as string },
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

describe('useOfflineSetup', () => {
  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    router.replace.mockClear()
    router.push.mockClear()
    router.currentRoute.name = 'Accounts'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupWizard = async (): Promise<ReturnType<typeof import('../useOfflineSetup')['useOfflineSetup']>> => {
    const { useOfflineSetup } = await import('../useOfflineSetup')
    const { result } = withSetup(() => useOfflineSetup())
    await nextTick()
    return result
  }

  const startRedirect = async (): Promise<void> => {
    const { startOfflineSetupRedirect } = await import('../useOfflineSetup')
    withSetup((): void => {
      startOfflineSetupRedirect()
    })
  }

  it('routes home when the config already exists and no profile is needed', async () => {
    const core = useCoreStore()
    core.offlineBuild = false
    core.applyLauncherConfig(makeLauncherConfig())

    const setup = await setupWizard()

    expect(router.replace).toHaveBeenCalledWith('/')
    expect(setup.needsProfile.value).toBe(false)
    expect(setup.step.value).toBe(1)
  })

  it('moves to the profile step for an offline build without projects', async () => {
    const core = useCoreStore()
    core.offlineBuild = true
    core.applyLauncherConfig(makeLauncherConfig({ projectNames: [], currentProject: null }))

    const setup = await setupWizard()

    expect(setup.needsProfile.value).toBe(true)
    expect(setup.step.value).toBe(2)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('stays on the folder step while there is no config', async () => {
    const core = useCoreStore()
    core.offlineBuild = true

    const setup = await setupWizard()

    expect(setup.step.value).toBe(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('advances to the profile step after the folder step is saved', async () => {
    const core = useCoreStore()
    core.offlineBuild = true

    const setup = await setupWizard()

    core.applyLauncherConfig(makeLauncherConfig({ projectNames: [], currentProject: null }))
    await vi.waitFor(() => expect(setup.step.value).toBe(2))

    expect(router.replace).not.toHaveBeenCalled()
  })

  it('routes home after the folder step is saved when no profile is needed', async () => {
    const core = useCoreStore()
    core.offlineBuild = false

    const setup = await setupWizard()

    core.applyLauncherConfig(makeLauncherConfig())
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))

    expect(setup.step.value).toBe(1)
  })

  it('forces the setup screen when the offline gate turns on', async () => {
    const core = useCoreStore()
    await startRedirect()

    core.offlineBuild = true
    core.applyLauncherConfig(makeLauncherConfig({ projectNames: [], currentProject: null }))
    await nextTick()

    expect(router.replace).toHaveBeenCalledWith({ name: 'Setup' })
  })

  it('leaves the route alone while the offline gate is off', async () => {
    const core = useCoreStore()
    await startRedirect()

    core.offlineBuild = false
    core.applyLauncherConfig(makeLauncherConfig())
    await nextTick()

    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does not re-replace the route while already on setup', async () => {
    const core = useCoreStore()
    router.currentRoute.name = 'Setup'
    await startRedirect()

    core.offlineBuild = true
    core.applyLauncherConfig(makeLauncherConfig({ projectNames: [], currentProject: null }))
    await nextTick()

    expect(router.replace).not.toHaveBeenCalled()
  })
})
