import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { saveLauncherSettings } from '@/06-shared/api'
import { isAutostartEnabled } from '@/06-shared'
import { useCoreStore, type LauncherConfig } from '@/05-entities'
import { useLauncherSettings } from './useLauncherSettings'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  saveLauncherSettings: vi.fn(),
  saveLauncherConfig: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  isAutostartEnabled: vi.fn(),
  selectDirectory: vi.fn(),
}))

const makeLauncherConfig = (debugMode: boolean): LauncherConfig => ({
  launcherPath: '/launcher',
  discordActivity: false,
  keepOldConfigs: false,
  downloadSpeedLimit: null,
  autoUpdate: true,
  systemNotifications: false,
  debugMode,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: false,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames: ['Alpha'],
  currentProject: 'Alpha',
  projects: {},
})

describe('useLauncherSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('live-dirties when a field changes and cleans up when reverted', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    expect(settings.isDirty.value).toBe(false)

    settings.debugMode.value = true
    expect(settings.isDirty.value).toBe(true)

    settings.debugMode.value = false
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('resets dirty state after a successful save', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.debugMode.value = true
    expect(settings.isDirty.value).toBe(true)

    await settings.handleSave()

    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })
})
