import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { initializeLauncher, saveAnimationsEnabled } from '@/06-shared/api'
import {
  useCoreStore,
  useNotificationStore,
  useSettingsStore,
  type LauncherConfig,
} from '@/05-entities'
import { useSetup } from '../useSetup'
import { withSetup } from '@/test-support/withSetup'

const shared = vi.hoisted(() => ({
  prefersReducedMotion: vi.fn(),
  selectDirectory: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  initializeLauncher: vi.fn(),
  saveAnimationsEnabled: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  prefersReducedMotion: shared.prefersReducedMotion,
  selectDirectory: shared.selectDirectory,
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

describe('useSetup', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    shared.prefersReducedMotion.mockReset()
    shared.selectDirectory.mockReset()
    shared.prefersReducedMotion.mockReturnValue(false)
    vi.mocked(initializeLauncher).mockReset()
    vi.mocked(saveAnimationsEnabled).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupWizard = (): ReturnType<typeof useSetup> => {
    const { result } = withSetup(() => useSetup())
    return result
  }

  it('seeds the path from the default parent and joins the launcher folder', () => {
    const core = useCoreStore()
    core.defaultParentPath = '/games'
    core.launcherName = 'Limacina'

    const setup = setupWizard()

    expect(setup.selectedPath.value).toBe('/games')
    expect(setup.fullDisplayPath.value).toBe('/games/Limacina')
  })

  it('shows an empty display path without a launcher name', () => {
    const core = useCoreStore()
    core.defaultParentPath = '/games'
    core.launcherName = ''
    const setup = setupWizard()

    expect(setup.fullDisplayPath.value).toBe('')
  })

  it('updates the folder from the directory dialog', async () => {
    shared.selectDirectory.mockResolvedValueOnce('/other/games')
    shared.selectDirectory.mockResolvedValueOnce(null)
    useCoreStore().defaultParentPath = '/games'
    const setup = setupWizard()

    await setup.selectFolder()
    expect(setup.selectedPath.value).toBe('/other/games')

    await setup.selectFolder()
    expect(setup.selectedPath.value).toBe('/other/games')
  })

  it('initializes the launcher and applies the config', async () => {
    vi.mocked(initializeLauncher).mockResolvedValue(makeLauncherConfig())
    const core = useCoreStore()
    core.defaultParentPath = '/games'
    core.launcherName = 'Limacina'
    const setup = setupWizard()

    await setup.save()

    expect(initializeLauncher).toHaveBeenCalledWith('/games')
    expect(core.launcherConfig).toEqual(makeLauncherConfig())
    expect(core.hasLauncherConfig).toBe(true)
    expect(core.projects).toEqual(['proj'])
    expect(setup.isLoading.value).toBe(false)
  })

  it('disables animations for reduced motion after the init', async () => {
    shared.prefersReducedMotion.mockReturnValue(true)
    vi.mocked(initializeLauncher).mockResolvedValue(
      makeLauncherConfig({ projectNames: [], currentProject: null }),
    )
    vi.mocked(saveAnimationsEnabled).mockResolvedValue(
      makeLauncherConfig({ projectNames: [], currentProject: null }),
    )
    const core = useCoreStore()
    core.defaultParentPath = '/games'
    const setup = setupWizard()

    await setup.save()

    expect(useSettingsStore().animationsEnabled).toBe(false)
    expect(saveAnimationsEnabled).toHaveBeenCalledWith(false)
  })

  it('shows the error when initialization fails', async () => {
    vi.mocked(initializeLauncher).mockRejectedValue(new Error('disk error'))
    useCoreStore().defaultParentPath = '/games'
    const setup = setupWizard()

    await setup.save()

    expect(useNotificationStore().message).toBe('disk error')
    expect(setup.isLoading.value).toBe(false)
    expect(useCoreStore().hasLauncherConfig).not.toBe(true)
  })

  it('ignores a repeated save while one is running', async () => {
    let releaseInit: () => void = () => {}
    vi.mocked(initializeLauncher).mockImplementationOnce(
      () =>
        new Promise<LauncherConfig>((resolve) => {
          releaseInit = (): void => resolve(makeLauncherConfig())
        }),
    )
    useCoreStore().defaultParentPath = '/games'
    const setup = setupWizard()

    const first = setup.save()
    await setup.save()
    expect(initializeLauncher).toHaveBeenCalledTimes(1)

    releaseInit()
    await first
  })
})
