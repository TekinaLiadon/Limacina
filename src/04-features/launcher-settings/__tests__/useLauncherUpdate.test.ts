import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { applyUpdateCmd, getLauncherVersions } from '@/06-shared/api'
import { useCoreStore, useNotificationStore, type UpdateInfo } from '@/05-entities'
import { useLauncherUpdate } from '../useLauncherUpdate'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  applyUpdateCmd: vi.fn(),
  getLauncherVersions: vi.fn(),
}))

const makeVersion = (version: string): UpdateInfo => ({ version })

describe('useLauncherUpdate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getLauncherVersions).mockReset()
    vi.mocked(applyUpdateCmd).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupUpdate = (): ReturnType<typeof useLauncherUpdate> => {
    const { result } = withSetup(() => useLauncherUpdate())
    return result
  }

  it('loads the versions on mount and selects the current one', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockResolvedValue([makeVersion('1.2.3'), makeVersion('1.3.0')])

    const update = setupUpdate()
    await vi.waitFor(() => expect(update.versions.value).toHaveLength(2))

    expect(update.currentVersion.value).toBe('1.2.3')
    expect(update.selectedVersion.value).toBe('1.2.3')
    expect(update.isApplyDisabled.value).toBe(true)
    expect(update.isLoading.value).toBe(false)
  })

  it('shows the load error and recovers on retry', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockRejectedValueOnce(new Error('network down'))
    vi.mocked(getLauncherVersions).mockResolvedValueOnce([makeVersion('1.3.0')])

    const update = setupUpdate()
    await vi.waitFor(() => expect(update.loadError.value).toBe('network down'))

    await update.retryLoad()

    expect(update.loadError.value).toBe('')
    expect(update.versions.value).toEqual([makeVersion('1.3.0')])
    expect(update.selectedVersion.value).toBe('1.2.3')
  })

  it('enables the apply action for another version', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockResolvedValue([makeVersion('1.2.3'), makeVersion('1.3.0')])

    const update = setupUpdate()
    await vi.waitFor(() => expect(update.versions.value).toHaveLength(2))
    update.selectVersion('1.3.0')

    expect(update.isApplyDisabled.value).toBe(false)
  })

  it('applies the selected version after confirmation', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockResolvedValue([makeVersion('1.2.3'), makeVersion('1.3.0')])
    vi.mocked(applyUpdateCmd).mockResolvedValue(undefined)
    const update = setupUpdate()
    await vi.waitFor(() => expect(update.versions.value).toHaveLength(2))
    update.selectVersion('1.3.0')

    const pending = update.handleApplyVersion()
    useNotificationStore().resolvePopup(true)
    await pending

    expect(applyUpdateCmd).toHaveBeenCalledWith('1.3.0')
    expect(useNotificationStore().message).toBe('Установлена версия v1.3.0, лаунчер перезапускается...')
    expect(update.isApplying.value).toBe(false)
  })

  it('does not apply when the confirmation is declined', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockResolvedValue([makeVersion('1.2.3'), makeVersion('1.3.0')])
    const update = setupUpdate()
    await vi.waitFor(() => expect(update.versions.value).toHaveLength(2))
    update.selectVersion('1.3.0')

    const pending = update.handleApplyVersion()
    useNotificationStore().resolvePopup(false)
    await pending

    expect(applyUpdateCmd).not.toHaveBeenCalled()
    expect(update.isApplying.value).toBe(false)
  })

  it('shows the error when the update fails', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockResolvedValue([makeVersion('1.2.3'), makeVersion('1.3.0')])
    vi.mocked(applyUpdateCmd).mockRejectedValue(new Error('signature mismatch'))
    const update = setupUpdate()
    await vi.waitFor(() => expect(update.versions.value).toHaveLength(2))
    update.selectVersion('1.3.0')

    const pending = update.handleApplyVersion()
    useNotificationStore().resolvePopup(true)
    await pending

    expect(useNotificationStore().message).toBe('signature mismatch')
    expect(update.isApplying.value).toBe(false)
  })

  it('skips the apply for the running version without asking', async () => {
    useCoreStore().version = '1.2.3'
    vi.mocked(getLauncherVersions).mockResolvedValue([makeVersion('1.2.3')])
    const update = setupUpdate()
    await vi.waitFor(() => expect(update.versions.value).toHaveLength(1))

    await update.handleApplyVersion()

    expect(applyUpdateCmd).not.toHaveBeenCalled()
  })
})
