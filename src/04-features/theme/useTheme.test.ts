import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationStore, useSettingsStore } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'

const api = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  setWindowBackgroundColor: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  saveTheme: api.saveTheme,
  setWindowBackgroundColor: api.setWindowBackgroundColor,
}))

interface ThemeApi {
  isSwitching: { value: boolean }
  switchDirection: { value: 'to-light' | 'to-dark' }
}

describe('useTheme', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.saveTheme.mockReset()
    api.saveTheme.mockResolvedValue({} as never)
    api.setWindowBackgroundColor.mockReset()
    api.setWindowBackgroundColor.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const loadTheme = async (): Promise<ThemeApi> => {
    const { useTheme } = await import('./useTheme')
    const { result } = withSetup(() => useTheme())
    return { isSwitching: result.isSwitching, switchDirection: result.switchDirection }
  }

  const prepareStore = (theme: string, animations: boolean): void => {
    const settings = useSettingsStore()
    settings.setTheme(theme)
    settings.setAnimationsEnabled(animations)
  }

  it('applies the current theme on setup', async () => {
    prepareStore('lime-dark', true)

    await loadTheme()

    expect(document.documentElement.getAttribute('data-theme')).toBe('lime-dark')
  })

  it('switches within the same mode immediately', async () => {
    prepareStore('default-dark', true)
    const theme = await loadTheme()

    useSettingsStore().setTheme('lime-dark')
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('lime-dark')
    expect(theme.isSwitching.value).toBe(false)
    expect(api.saveTheme).toHaveBeenCalledWith('lime-dark')
  })

  it('plays the switch animation across modes when animations are on', async () => {
    prepareStore('default-dark', true)
    const theme = await loadTheme()

    useSettingsStore().setTheme('lime-light')
    await nextTick()

    expect(theme.isSwitching.value).toBe(true)
    expect(theme.switchDirection.value).toBe('to-light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('default-dark')

    await vi.advanceTimersByTimeAsync(1500)

    expect(document.documentElement.getAttribute('data-theme')).toBe('lime-light')
    expect(theme.isSwitching.value).toBe(false)
  })

  it('keeps the applied theme when a stale switch timer fires', async () => {
    prepareStore('default-dark', true)
    const theme = await loadTheme()

    useSettingsStore().setTheme('lime-light')
    await nextTick()
    expect(theme.isSwitching.value).toBe(true)

    useSettingsStore().setTheme('default-light')
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('default-light')
    expect(theme.isSwitching.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1500)

    expect(document.documentElement.getAttribute('data-theme')).toBe('default-light')
  })

  it('cancels the pending switch timer when the next change skips animation', async () => {
    prepareStore('default-dark', true)
    const theme = await loadTheme()

    useSettingsStore().setTheme('lime-light')
    await nextTick()
    expect(theme.isSwitching.value).toBe(true)

    useSettingsStore().setAnimationsEnabled(false)
    useSettingsStore().setTheme('default-light')
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('default-light')
    expect(theme.isSwitching.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1500)

    expect(document.documentElement.getAttribute('data-theme')).toBe('default-light')
  })

  it('reports the direction for a light to dark switch', async () => {
    prepareStore('lime-light', true)
    const theme = await loadTheme()

    useSettingsStore().setTheme('lime-dark')
    await nextTick()

    expect(theme.isSwitching.value).toBe(true)
    expect(theme.switchDirection.value).toBe('to-dark')

    await vi.advanceTimersByTimeAsync(1500)
    expect(document.documentElement.getAttribute('data-theme')).toBe('lime-dark')
  })

  it('applies the cross-mode change immediately when animations are off', async () => {
    prepareStore('default-dark', false)
    const theme = await loadTheme()

    useSettingsStore().setTheme('lime-light')
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('lime-light')
    expect(theme.isSwitching.value).toBe(false)
  })

  it('toasts when the theme choice cannot be saved', async () => {
    prepareStore('default-dark', true)
    api.saveTheme.mockRejectedValue(new Error('disk full'))
    await loadTheme()

    useSettingsStore().setTheme('lime-dark')
    await nextTick()
    await Promise.resolve()

    expect(useNotificationStore().message).toBe(
      'Тема применена, но не сохранена — после перезапуска вернётся прежняя',
    )
  })
})
