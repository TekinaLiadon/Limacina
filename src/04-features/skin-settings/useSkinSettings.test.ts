import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  deleteOfflineSkin,
  deleteSkin,
  getOfflineSkin,
  getOfflineSkinModel,
  getProfileSkin,
  listSkins,
  readSkinFile,
  saveOfflineSkin,
  setActiveSkin,
  uploadSkin,
} from '@/06-shared/api'
import {
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
  type UserContentItem,
} from '@/05-entities'
import { useSkinSettings } from './useSkinSettings'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  deleteOfflineSkin: vi.fn(),
  deleteSkin: vi.fn(),
  getOfflineSkin: vi.fn(),
  getOfflineSkinModel: vi.fn(),
  getProfileSkin: vi.fn(),
  listSkins: vi.fn(),
  readSkinFile: vi.fn(),
  saveOfflineSkin: vi.fn(),
  setActiveSkin: vi.fn(),
  uploadSkin: vi.fn(),
}))

const createObjectURLMock = vi.fn((): string => 'blob:mock-url')
const revokeObjectURLMock = vi.fn()
URL.createObjectURL = createObjectURLMock
URL.revokeObjectURL = revokeObjectURLMock

const createImageBitmapMock = vi.fn(async (): Promise<{ close: () => void }> => ({ close: () => {} }))
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
  legacy: false,
  legacyProfile: null,
})

const makeSkin = (id: number, active = false): UserContentItem => ({
  id,
  url: `https://cdn/${id}.png`,
  model: 'classic',
  active,
})

describe('useSkinSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteOfflineSkin).mockReset()
    vi.mocked(deleteSkin).mockReset()
    vi.mocked(getOfflineSkin).mockReset()
    vi.mocked(getOfflineSkinModel).mockReset()
    vi.mocked(getProfileSkin).mockReset()
    vi.mocked(listSkins).mockReset()
    vi.mocked(readSkinFile).mockReset()
    vi.mocked(saveOfflineSkin).mockReset()
    vi.mocked(setActiveSkin).mockReset()
    vi.mocked(uploadSkin).mockReset()
    vi.mocked(listSkins).mockResolvedValue([])
    vi.mocked(getProfileSkin).mockResolvedValue(new Uint8Array([1, 2, 3]))
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array())
    createImageBitmapMock.mockClear()
    createObjectURLMock.mockClear()
    revokeObjectURLMock.mockClear()
    useCoreStore().currentProject = 'proj'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupSkins = (): ReturnType<typeof useSkinSettings> => {
    const { result } = withSetup(() => useSkinSettings())
    return result
  }

  const goOnline = (): void => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig(true)
    core.session = { uuid: 'u-1', username: 'alice' }
  }

  const goOffline = (): void => {
    useCoreStore().projectConfig = makeProjectConfig(false)
  }

  it('auto-loads the active skin preview for the online project', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))

    expect(getProfileSkin).toHaveBeenCalledWith('https://cdn/1.png')
    expect(skins.hasSkin.value).toBe(true)
    expect(skins.isSkinLoading.value).toBe(false)
  })

  it('falls back to the first item when nothing is marked active', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(5)])
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    expect(getProfileSkin).toHaveBeenCalledWith('https://cdn/5.png')
  })

  it('keeps the preview silent failure when the profile skin cannot load', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1)])
    vi.mocked(getProfileSkin).mockRejectedValue(new Error('cache miss'))
    const skins = setupSkins()

    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())

    expect(skins.hasSkin.value).toBe(false)
  })

  it('loads the offline skin with the stored model', async () => {
    goOffline()
    vi.mocked(getOfflineSkin).mockResolvedValue(new Uint8Array([9, 9]))
    vi.mocked(getOfflineSkinModel).mockResolvedValue('slim')
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))

    expect(skins.modelMode.value).toBe('slim')
    expect(getProfileSkin).not.toHaveBeenCalled()
  })

  it('stays empty for an offline project without a stored skin', async () => {
    goOffline()
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    expect(skins.hasSkin.value).toBe(false)
    expect(getOfflineSkinModel).not.toHaveBeenCalled()
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

    expect(saveOfflineSkin).toHaveBeenCalledWith(expect.any(Uint8Array), 'slim')
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

  it('skips the upload without pending skin bytes', async () => {
    goOnline()
    vi.mocked(uploadSkin).mockResolvedValue(makeSkin(2))
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    await skins.handleUpload()

    expect(uploadSkin).not.toHaveBeenCalled()
  })

  it('activates a skin and reloads the preview', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    vi.mocked(setActiveSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    await skins.handleActivate(1)

    expect(setActiveSkin).toHaveBeenCalledWith(1)
    expect(getProfileSkin).toHaveBeenCalledTimes(2)
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

  it('deletes a skin from the list after confirmation', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    vi.mocked(deleteSkin).mockResolvedValue(undefined)
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    const pending = skins.handleDelete(1)
    useNotificationStore().resolvePopup(true)
    await pending

    expect(deleteSkin).toHaveBeenCalledWith(1)
    expect(getProfileSkin).toHaveBeenCalledTimes(2)
  })

  it('keeps the latest preview when activation responses race', async () => {
    goOnline()
    let activeId = 1
    vi.mocked(listSkins).mockImplementation(async () => [
      makeSkin(1, activeId === 1),
      makeSkin(2, activeId === 2),
    ])
    vi.mocked(setActiveSkin).mockImplementation(async (id: number): Promise<void> => {
      activeId = id
    })
    createObjectURLMock.mockReturnValueOnce('blob:initial')
    createObjectURLMock.mockReturnValueOnce('blob:current')
    let releaseSlow: (bytes: Uint8Array) => void = () => {}
    vi.mocked(getProfileSkin).mockReset()
    vi.mocked(getProfileSkin)
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockImplementationOnce(
        () =>
          new Promise<Uint8Array>((resolve) => {
            releaseSlow = resolve
          }),
      )
      .mockResolvedValueOnce(new Uint8Array([3]))
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:initial'))

    const slowActivation = skins.handleActivate(2)
    await vi.waitFor(() => expect(getProfileSkin).toHaveBeenCalledTimes(2))
    expect(getProfileSkin).toHaveBeenNthCalledWith(2, 'https://cdn/2.png')

    await skins.handleActivate(1)
    expect(getProfileSkin).toHaveBeenNthCalledWith(3, 'https://cdn/1.png')
    expect(skins.skinUrl.value).toBe('blob:current')

    releaseSlow(new Uint8Array([2]))
    await slowActivation

    expect(skins.skinUrl.value).toBe('blob:current')
    expect(createObjectURLMock).toHaveBeenCalledTimes(2)
    expect(revokeObjectURLMock).not.toHaveBeenCalledWith('blob:current')
  })
})
