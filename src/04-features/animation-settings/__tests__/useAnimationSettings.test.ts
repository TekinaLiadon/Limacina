import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { saveAnimationsEnabled } from '@/06-shared/api'
import { useCoreStore, useNotificationStore, useSettingsStore, type LauncherConfig } from '@/05-entities'
import { useAnimationSettings } from '../useAnimationSettings'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  saveAnimationsEnabled: vi.fn(),
}))

const makeConfig = (animationsEnabled: boolean): LauncherConfig => ({
  launcherPath: '/launcher',
  installId: null,
  discordActivity: false,
  keepOldConfigs: false,
  downloadSpeedLimit: null,
  autoUpdate: false,
  systemNotifications: false,
  debugMode: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: false,
  theme: 'default-dark',
  animationsEnabled,
  projectNames: [],
  currentProject: null,
  projects: {},
})

describe('useAnimationSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveAnimationsEnabled).mockReset()
    useSettingsStore().setAnimationsEnabled(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists the new value through the command', async () => {
    vi.mocked(saveAnimationsEnabled).mockResolvedValue(makeConfig(false))
    const animations = useAnimationSettings()

    await animations.setAnimationsEnabled(false)

    expect(saveAnimationsEnabled).toHaveBeenCalledWith(false)
    expect(animations.animationsEnabled.value).toBe(false)
    expect(document.documentElement.dataset.animations).toBe('off')
  })

  it('flips the current value on toggle', async () => {
    vi.mocked(saveAnimationsEnabled).mockResolvedValue(makeConfig(false))
    const animations = useAnimationSettings()

    await animations.toggleAnimations()
    expect(animations.animationsEnabled.value).toBe(false)

    await animations.toggleAnimations()
    expect(animations.animationsEnabled.value).toBe(true)
  })

  it('reverts the store value when the command fails', async () => {
    vi.mocked(saveAnimationsEnabled).mockRejectedValue(new Error('disk full'))
    const animations = useAnimationSettings()

    await animations.setAnimationsEnabled(false)

    expect(animations.animationsEnabled.value).toBe(true)
    expect(useNotificationStore().message).toBe('disk full')
    expect(document.documentElement.dataset.animations).toBe('on')
  })

  it('ignores repeated clicks while the save is in flight', async () => {
    let release: (error: Error) => void = () => {}
    vi.mocked(saveAnimationsEnabled).mockImplementationOnce(
      () =>
        new Promise<never>((_, reject) => {
          release = reject
        }),
    )
    const animations = useAnimationSettings()

    const first = animations.setAnimationsEnabled(false)
    await animations.setAnimationsEnabled(true)

    expect(saveAnimationsEnabled).toHaveBeenCalledTimes(1)
    expect(animations.animationsEnabled.value).toBe(false)

    release(new Error('disk full'))
    await first

    expect(animations.animationsEnabled.value).toBe(true)
    expect(document.documentElement.dataset.animations).toBe('on')
  })

  it('saves without rolling back the live project scope', async () => {
    const core = useCoreStore()
    core.setLauncherConfig({
      ...makeConfig(true),
      projectNames: ['alpha', 'beta'],
      currentProject: 'beta',
    })
    vi.mocked(saveAnimationsEnabled).mockResolvedValue({
      ...makeConfig(false),
      projectNames: ['alpha'],
      currentProject: 'alpha',
    })
    const animations = useAnimationSettings()

    await animations.setAnimationsEnabled(false)

    expect(core.launcherConfig?.animationsEnabled).toBe(false)
    expect(core.currentProject).toBe('beta')
    expect(core.projects).toEqual(['alpha', 'beta'])
  })

  it('patches only the animations flag without overwriting a newer theme', async () => {
    const core = useCoreStore()
    core.setLauncherConfig({ ...makeConfig(true), theme: 'lime-dark' })
    vi.mocked(saveAnimationsEnabled).mockResolvedValue({
      ...makeConfig(false),
      theme: 'default-dark',
    })
    const animations = useAnimationSettings()

    await animations.setAnimationsEnabled(false)

    expect(core.launcherConfig?.animationsEnabled).toBe(false)
    expect(core.launcherConfig?.theme).toBe('lime-dark')
  })
})
