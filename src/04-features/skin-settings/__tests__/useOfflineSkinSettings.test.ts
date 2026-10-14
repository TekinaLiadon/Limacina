import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  deleteOfflineSkin,
  getOfflineSkin,
  getOfflineSkinModel,
  getProfileSkin,
  listSkins,
  saveOfflineSkin,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
  type SkinModelMode,
} from '@/05-entities'
import { useOfflineSkinSettings } from '../useOfflineSkinSettings'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  deleteOfflineSkin: vi.fn(),
  getOfflineSkin: vi.fn(),
  getOfflineSkinModel: vi.fn(),
  getProfileSkin: vi.fn(),
  listSkins: vi.fn(),
  saveOfflineSkin: vi.fn(),
}))

const createObjectURLMock = vi.fn((): string => 'blob:mock-url')
const revokeObjectURLMock = vi.fn()
URL.createObjectURL = createObjectURLMock
URL.revokeObjectURL = revokeObjectURLMock

interface FakeBitmap {
  width: number
  height: number
  close: () => void
}

const createImageBitmapMock = vi.fn(async (): Promise<FakeBitmap> => ({ width: 64, height: 64, close: () => {} }))
vi.stubGlobal('createImageBitmap', createImageBitmapMock)

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

describe('useOfflineSkinSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteOfflineSkin).mockReset()
    vi.mocked(getOfflineSkin).mockReset()
    vi.mocked(getOfflineSkinModel).mockReset()
    vi.mocked(getProfileSkin).mockReset()
    vi.mocked(listSkins).mockReset()
    vi.mocked(saveOfflineSkin).mockReset()
    vi.mocked(listSkins).mockResolvedValue([])
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array())
    createImageBitmapMock.mockClear()
    createObjectURLMock.mockClear()
    revokeObjectURLMock.mockClear()
    useCoreStore().currentProject = 'proj'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupSkins = (): ReturnType<typeof useOfflineSkinSettings> => {
    const { result } = withSetup(() => useOfflineSkinSettings())
    return result
  }

  const goOffline = (): void => {
    useCoreStore().projectConfig = makeProjectConfig(false)
  }

  it('loads the offline skin with the stored model', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('slim')
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))

    expect(skins.modelMode.value).toBe('slim')
    expect(getProfileSkin).not.toHaveBeenCalled()
  })

  it('surfaces the offline skin load error to the user', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockRejectedValue(new Error('disk gone'))
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.errorMessage.value).toBe('disk gone'))

    expect(skins.hasSkin.value).toBe(false)
  })

  it('keeps the loading state until the offline skin finishes loading', async () => {
    goOffline()
    let releaseModel: (model: SkinModelMode) => void = () => {}
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockImplementationOnce(
      () =>
        new Promise<SkinModelMode>((resolve) => {
          releaseModel = resolve
        }),
    )
    const { result, unmount } = withSetup(() => useOfflineSkinSettings())

    await vi.waitFor(() => expect(getOfflineSkinModel).toHaveBeenCalled())
    expect(result.isSkinLoading.value).toBe(true)

    releaseModel('classic')
    await flushPromises()
    expect(result.isSkinLoading.value).toBe(false)
    unmount()
  })

  it('stays empty for an offline project without a stored skin', async () => {
    goOffline()
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    expect(skins.hasSkin.value).toBe(false)
    expect(getOfflineSkinModel).not.toHaveBeenCalled()
  })

  it('accepts the legacy 64x32 skin format', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    createImageBitmapMock.mockResolvedValueOnce({ width: 64, height: 32, close: () => {} })
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))

    expect(skins.hasSkin.value).toBe(true)
  })

  it('rejects a skin whose size does not match the Minecraft formats', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    createImageBitmapMock.mockResolvedValueOnce({ width: 100, height: 50, close: () => {} })
    const skins = setupSkins()

    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())

    expect(skins.hasSkin.value).toBe(false)
    expect(skins.skinUrl.value).toBe('')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('does not re-persist the offline skin while restoring the stored model', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('slim')
    vi.mocked(saveOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))

    expect(skins.modelMode.value).toBe('slim')
    await nextTick()
    expect(saveOfflineSkin).not.toHaveBeenCalled()
    expect(skins.errorMessage.value).toBe('')
  })

  it('saves the offline skin when the model changes', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    vi.mocked(saveOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    skins.modelMode.value = 'slim'
    await vi.waitFor(() => expect(saveOfflineSkin).toHaveBeenCalledTimes(1))

    expect(saveOfflineSkin).toHaveBeenCalledWith('proj', expect.any(Uint8Array), 'slim')
  })

  it('surfaces the offline skin save error to the user', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    vi.mocked(saveOfflineSkin).mockRejectedValue(new Error('disk full'))
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    skins.modelMode.value = 'slim'
    await vi.waitFor(() => expect(saveOfflineSkin).toHaveBeenCalledTimes(1))

    expect(skins.errorMessage.value).toBe('Не удалось сохранить скин на диск')
    expect(console.error).toHaveBeenCalled()
  })

  it('serializes the offline skin writes when the model flips rapidly', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    let releaseFirst: () => void = () => {}
    vi.mocked(saveOfflineSkin).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        }),
    )
    vi.mocked(saveOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    skins.modelMode.value = 'slim'
    await nextTick()
    expect(saveOfflineSkin).toHaveBeenCalledTimes(1)

    skins.modelMode.value = 'classic'
    await nextTick()
    expect(saveOfflineSkin).toHaveBeenCalledTimes(1)

    releaseFirst()
    await vi.waitFor(() => expect(saveOfflineSkin).toHaveBeenCalledTimes(2))

    expect(saveOfflineSkin).toHaveBeenLastCalledWith('proj', expect.any(Uint8Array), 'classic')
  })

  it('revokes the pending offline skin url when the page unmounts mid-load', async () => {
    goOffline()
    let releaseModel: (model: SkinModelMode) => void = () => {}
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockImplementationOnce(
      () =>
        new Promise<SkinModelMode>((resolve) => {
          releaseModel = resolve
        }),
    )
    createObjectURLMock.mockReturnValueOnce('blob:pending-offline')
    const { result, unmount } = withSetup(() => useOfflineSkinSettings())
    await vi.waitFor(() => expect(getOfflineSkinModel).toHaveBeenCalled())

    unmount()
    releaseModel('classic')
    await flushPromises()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pending-offline')
    expect(result.skinUrl.value).toBe('')
  })

  it('skips the offline persistence without skin bytes', async () => {
    goOffline()
    vi.mocked(saveOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    skins.modelMode.value = 'slim'
    await Promise.resolve()

    expect(saveOfflineSkin).not.toHaveBeenCalled()
  })

  it('writes the queued offline save to the captured project even after a switch', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    let releaseFirst: () => void = () => {}
    vi.mocked(saveOfflineSkin).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        }),
    )
    vi.mocked(saveOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    skins.modelMode.value = 'slim'
    await nextTick()
    skins.modelMode.value = 'classic'
    await nextTick()
    expect(saveOfflineSkin).toHaveBeenCalledTimes(1)

    useCoreStore().currentProject = 'other'
    releaseFirst()
    await flushPromises()

    expect(saveOfflineSkin).toHaveBeenCalledTimes(2)
    expect(saveOfflineSkin).toHaveBeenLastCalledWith('proj', expect.any(Uint8Array), 'classic')
  })

  it('deletes the offline skin of the confirmed project when it switches mid-dialog', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    vi.mocked(deleteOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    const confirmed = skins.resetSkin()
    useCoreStore().currentProject = 'other'
    useNotificationStore().resolvePopup(true)
    await confirmed

    expect(deleteOfflineSkin).toHaveBeenCalledWith('proj')
  })

  it('resets the skin after confirmation and clears the offline file', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    vi.mocked(deleteOfflineSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    const declined = skins.resetSkin()
    useNotificationStore().resolvePopup(false)
    await declined
    expect(deleteOfflineSkin).not.toHaveBeenCalled()
    expect(skins.hasSkin.value).toBe(true)

    const confirmed = skins.resetSkin()
    useNotificationStore().resolvePopup(true)
    await confirmed

    expect(deleteOfflineSkin).toHaveBeenCalledTimes(1)
    expect(skins.hasSkin.value).toBe(false)
  })

  it('reloads the offline skin when the project switches to an offline project', async () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig(true)
    vi.mocked(listSkins).mockResolvedValue([])
    core.currentProject = 'proj'
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))
    expect(skins.hasSkin.value).toBe(false)

    core.projectConfig = makeProjectConfig(false)
    core.currentProject = 'offline-proj'
    useAccountsStore().clearSessionState()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('classic')
    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))

    expect(getOfflineSkin).toHaveBeenCalledWith('offline-proj')
    expect(getProfileSkin).not.toHaveBeenCalled()
  })
})
