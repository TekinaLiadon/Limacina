import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { saveLauncherSettings } from '@/06-shared/api'
import { isAutostartEnabled } from '@/06-shared'
import { useCoreStore, useNotificationStore, useSettingsDirtyStore, type LauncherConfig } from '@/05-entities'
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
  installId: null,
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

  it('applies the OS autostart state on mount when the toggle is untouched', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(true)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    expect(settings.startWithSystem.value).toBe(true)
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('keeps unrelated edits dirty when the mount autostart sync lands late', async () => {
    let releaseAutostart: (enabled: boolean) => void = () => {}
    vi.mocked(isAutostartEnabled).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseAutostart = resolve
        }),
    )
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())

    settings.debugMode.value = true
    expect(settings.isDirty.value).toBe(true)

    releaseAutostart(true)
    await flushPromises()

    expect(settings.startWithSystem.value).toBe(true)
    expect(settings.isDirty.value).toBe(true)

    settings.debugMode.value = false
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('keeps the user choice when the toggle happens before the autostart sync', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())

    settings.startWithSystem.value = true
    await flushPromises()

    expect(settings.startWithSystem.value).toBe(true)
    expect(settings.isDirty.value).toBe(true)

    unmount()
  })

  it('resets dirty state and skips the success toast when the autostart apply fails after a successful save', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.startWithSystem.value = true
    vi.mocked(isAutostartEnabled).mockRejectedValueOnce(new Error('autostart locked'))
    await settings.handleSave()

    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)
    expect(useNotificationStore().message).toBe('Не удалось включить автозапуск: autostart locked')
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('parses only whole-number speed limits', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    const savedLimit = async (raw: string): Promise<number | null> => {
      vi.mocked(saveLauncherSettings).mockClear()
      settings.downloadSpeedLimitInput.value = raw
      await settings.handleSave()
      const { calls } = vi.mocked(saveLauncherSettings).mock
      const lastCall = calls[calls.length - 1]
      return lastCall === undefined ? null : lastCall[0].downloadSpeedLimit
    }

    expect(await savedLimit('12abc')).toBeNull()
    expect(saveLauncherSettings).not.toHaveBeenCalled()
    expect(settings.downloadSpeedLimitError.value).not.toBe('')

    expect(await savedLimit('12')).toBe(12)
    expect(settings.downloadSpeedLimitError.value).toBe('')

    expect(await savedLimit('12.5')).toBeNull()
    expect(saveLauncherSettings).not.toHaveBeenCalled()
    expect(settings.downloadSpeedLimitError.value).not.toBe('')

    expect(await savedLimit(' 7 ')).toBe(7)
    expect(settings.downloadSpeedLimitError.value).toBe('')

    expect(await savedLimit('')).toBeNull()
    expect(settings.downloadSpeedLimitError.value).toBe('')

    expect(await savedLimit('0')).toBeNull()
    expect(saveLauncherSettings).not.toHaveBeenCalled()
    expect(settings.downloadSpeedLimitError.value).not.toBe('')

    unmount()
  })

  it('blocks the save while the speed limit input is invalid', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    vi.mocked(saveLauncherSettings).mockResolvedValue(makeLauncherConfig(false))
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.downloadSpeedLimitInput.value = '12abc'
    await settings.handleSave()

    expect(saveLauncherSettings).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe(settings.downloadSpeedLimitError.value)

    settings.downloadSpeedLimitInput.value = '12'
    await settings.handleSave()

    expect(saveLauncherSettings).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('tracks launcher path changes through the dirty snapshot', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()

    settings.launcherPath.value = '/other'
    expect(settings.isDirty.value).toBe(true)

    settings.launcherPath.value = '/launcher'
    expect(settings.isDirty.value).toBe(false)

    unmount()
  })

  it('registers the dirty tab in the settings registry and cleans up on unmount', async () => {
    vi.mocked(isAutostartEnabled).mockResolvedValue(false)
    useCoreStore().launcherConfig = makeLauncherConfig(false)

    const { result: settings, unmount } = withSetup(() => useLauncherSettings())
    await flushPromises()
    const registry = useSettingsDirtyStore()
    expect(registry.hasDirtyTabs).toBe(false)

    settings.launcherPath.value = '/other'
    await flushPromises()
    expect(registry.dirtyTabs).toEqual(['launcher'])

    settings.launcherPath.value = '/launcher'
    await flushPromises()
    expect(registry.hasDirtyTabs).toBe(false)

    settings.launcherPath.value = '/other'
    await flushPromises()
    expect(registry.hasDirtyTabs).toBe(true)

    unmount()
    expect(registry.hasDirtyTabs).toBe(false)
  })
})
