import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  getGameOptions,
  importGlobalGameOptions,
  saveGameOptions,
  saveGlobalGameOptions,
} from '@/06-shared/api'
import { useCoreStore, useNotificationStore, type GameOptions, type GameOptionsData } from '@/05-entities'
import { DEFAULT_GAME_OPTIONS, useGameOptions } from './useGameOptions'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getGameOptions: vi.fn(),
  importGlobalGameOptions: vi.fn(),
  saveGameOptions: vi.fn(),
  saveGlobalGameOptions: vi.fn(),
}))

const makeData = (options: Partial<GameOptions> = {}, data: Partial<GameOptionsData> = {}): GameOptionsData => ({
  options: { ...DEFAULT_GAME_OPTIONS, ...options },
  fileExists: true,
  availableResourcePacks: ['faithful.zip'],
  hasGlobal: false,
  ...data,
})

describe('useGameOptions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getGameOptions).mockReset()
    vi.mocked(importGlobalGameOptions).mockReset()
    vi.mocked(saveGameOptions).mockReset()
    vi.mocked(saveGlobalGameOptions).mockReset()
    useCoreStore().currentProject = 'proj'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupOptions = (): ReturnType<typeof useGameOptions> => {
    const { result } = withSetup(() => useGameOptions())
    return result
  }

  it('loads options and merges them over the defaults', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(
      makeData({ fov: 90, gamma: 1.2 }, { hasGlobal: true }),
    )
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    expect(getGameOptions).toHaveBeenCalledWith('proj')
    expect(options.options.value.fov).toBe(90)
    expect(options.options.value.gamma).toBe(1.2)
    expect(options.options.value.renderDistance).toBe(12)
    expect(options.availableResourcePacks.value).toEqual(['faithful.zip'])
    expect(options.hasGlobal.value).toBe(true)
    expect(options.isLoading.value).toBe(false)
    expect(options.loadError.value).toBe('')
    expect(options.isDirty.value).toBe(false)
  })

  it('reports the load error and recovers on retry', async () => {
    vi.mocked(getGameOptions).mockRejectedValueOnce(new Error('options unreadable'))
    vi.mocked(getGameOptions).mockResolvedValueOnce(makeData({ fov: 90 }))
    const options = setupOptions()

    await vi.waitFor(() => expect(options.loadError.value).toBe('options unreadable'))

    await options.retryLoad()

    expect(options.loadError.value).toBe('')
    expect(options.options.value.fov).toBe(90)
    expect(options.options.value.renderDistance).toBe(DEFAULT_GAME_OPTIONS.renderDistance)
    expect(options.isDirty.value).toBe(false)
  })

  it('drops a stale response after the project has switched', async () => {
    let releaseAlpha: (data: GameOptionsData) => void = () => {}
    vi.mocked(getGameOptions).mockImplementationOnce(
      () =>
        new Promise<GameOptionsData>((resolve) => {
          releaseAlpha = resolve
        }),
    )
    vi.mocked(getGameOptions).mockResolvedValueOnce(makeData({ fov: 60 }))
    const core = useCoreStore()
    const options = setupOptions()
    await vi.waitFor(() => expect(getGameOptions).toHaveBeenCalledTimes(1))

    core.currentProject = 'beta'
    await vi.waitFor(() => expect(options.options.value.fov).toBe(60))

    releaseAlpha(makeData({ fov: 110 }))

    expect(options.options.value.fov).toBe(60)
    expect(options.loadError.value).toBe('')
  })

  it('does not save while the options are still loading', async () => {
    vi.mocked(getGameOptions).mockReturnValue(new Promise(() => {}))
    const options = setupOptions()

    await options.handleSave()

    expect(saveGameOptions).not.toHaveBeenCalled()
  })

  it('saves the options and recaptures the dirty baseline', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    vi.mocked(saveGameOptions).mockResolvedValue(undefined)
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    options.options.value.fov = 110
    expect(options.isDirty.value).toBe(true)

    await options.handleSave()

    expect(saveGameOptions).toHaveBeenCalledWith('proj', expect.objectContaining({ fov: 110 }))
    expect(options.fileExists.value).toBe(true)
    expect(useNotificationStore().message).toBe('Настройки игры сохранены')
    expect(options.isDirty.value).toBe(false)
    expect(options.isSaving.value).toBe(false)
  })

  it('skips the post-save state when the project has switched mid-save', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    const core = useCoreStore()
    vi.mocked(saveGameOptions).mockImplementation(async () => {
      core.currentProject = 'beta'
    })
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    options.options.value.fov = 110
    await options.handleSave()

    expect(saveGameOptions).toHaveBeenCalledWith('proj', expect.objectContaining({ fov: 110 }))
    expect(useNotificationStore().message).toBe('')
    expect(options.isSaving.value).toBe(false)
  })

  it('blocks the save while the load failed', async () => {
    vi.mocked(getGameOptions).mockRejectedValue(new Error('options unreadable'))
    const options = setupOptions()
    await vi.waitFor(() => expect(options.loadError.value).not.toBe(''))

    await options.handleSave()

    expect(saveGameOptions).not.toHaveBeenCalled()
  })

  it('shows the save error', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    vi.mocked(saveGameOptions).mockRejectedValue(new Error('disk full'))
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    await options.handleSave()

    expect(useNotificationStore().message).toBe('disk full')
    expect(options.isSaving.value).toBe(false)
  })

  it('notifies when there are no global options to import', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    vi.mocked(importGlobalGameOptions).mockResolvedValue(null)
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    await options.handleImportGlobal()

    expect(options.options.value.fov).toBe(DEFAULT_GAME_OPTIONS.fov)
    expect(useNotificationStore().message).toBe('Общие настройки не найдены')
  })

  it('applies the imported global options without saving them', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    const global: Partial<GameOptions> = { fov: 75, gamma: 0 }
    vi.mocked(importGlobalGameOptions).mockResolvedValue(global as GameOptions)
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    await options.handleImportGlobal()

    expect(options.options.value.fov).toBe(75)
    expect(options.options.value.gamma).toBe(0)
    expect(options.options.value.renderDistance).toBe(12)
    expect(options.isDirty.value).toBe(true)
    expect(useNotificationStore().message).toBe('Общие настройки подставлены, не забудьте сохранить')
  })

  it('saves the options as global', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    vi.mocked(saveGlobalGameOptions).mockResolvedValue(undefined)
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    await options.handleSaveGlobal()

    expect(saveGlobalGameOptions).toHaveBeenCalledWith(options.options.value)
    expect(options.hasGlobal.value).toBe(true)
    expect(useNotificationStore().message).toBe('Настройки сохранены как общие')
  })

  it('shows the global save error', async () => {
    vi.mocked(getGameOptions).mockResolvedValue(makeData())
    vi.mocked(saveGlobalGameOptions).mockRejectedValue(new Error('denied'))
    const options = setupOptions()
    await vi.waitFor(() => expect(options.fileExists.value).toBe(true))

    await options.handleSaveGlobal()

    expect(useNotificationStore().message).toBe('denied')
    expect(options.isSavingGlobal.value).toBe(false)
  })
})
