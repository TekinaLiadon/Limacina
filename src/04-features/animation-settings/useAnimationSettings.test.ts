import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { saveAnimationsEnabled } from '@/06-shared/api'
import { useCoreStore, useNotificationStore, useSettingsStore } from '@/05-entities'
import { useAnimationSettings } from './useAnimationSettings'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  saveAnimationsEnabled: vi.fn(),
}))

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
    vi.mocked(saveAnimationsEnabled).mockResolvedValue({} as never)
    const animations = useAnimationSettings()

    await animations.setAnimationsEnabled(false)

    expect(saveAnimationsEnabled).toHaveBeenCalledWith(false)
    expect(animations.animationsEnabled.value).toBe(false)
    expect(document.documentElement.dataset.animations).toBe('off')
  })

  it('flips the current value on toggle', async () => {
    vi.mocked(saveAnimationsEnabled).mockResolvedValue({} as never)
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

  it('stores the config returned by the command in the core store', async () => {
    const config = { animationsEnabled: false } as never
    vi.mocked(saveAnimationsEnabled).mockResolvedValue(config)
    const animations = useAnimationSettings()

    await animations.setAnimationsEnabled(false)

    expect(useCoreStore().launcherConfig).toEqual(config)
  })
})
