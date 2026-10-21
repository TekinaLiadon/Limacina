import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
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
  setActiveSkin,
  uploadSkin,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type UserContentItem,
} from '@/05-entities'
import { useSkinSettings } from '../useSkinSettings'
import { withSetup } from '@/test-support/withSetup'
import { makeProjectConfig } from '@/test-support/fixtures'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  deleteOfflineSkin: vi.fn(),
  deleteSkin: vi.fn(),
  getOfflineSkin: vi.fn(),
  getOfflineSkinModel: vi.fn(),
  getProfileSkin: vi.fn(),
  listSkins: vi.fn(),
  readSkinFile: vi.fn(),
  setActiveSkin: vi.fn(),
  uploadSkin: vi.fn(),
}))

const shared = vi.hoisted(() => ({
  selectFile: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  selectFile: shared.selectFile,
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
    vi.mocked(setActiveSkin).mockReset()
    vi.mocked(uploadSkin).mockReset()
    shared.selectFile.mockReset()
    vi.mocked(listSkins).mockResolvedValue([])
    vi.mocked(getProfileSkin).mockResolvedValue(new Uint8Array([1, 2, 3]))
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
    core.projectConfig = makeProjectConfig({ online: true })
    useAccountsStore().session = { uuid: 'u-1', username: 'alice' }
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

  it('surfaces the profile skin load error to the user', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1)])
    vi.mocked(getProfileSkin).mockRejectedValue(new Error('cache miss'))
    const skins = setupSkins()

    await vi.waitFor(() => expect(skins.errorMessage.value).toBe('cache miss'))

    expect(console.error).toHaveBeenCalled()
    expect(skins.hasSkin.value).toBe(false)
  })

  it('does not touch the offline skin storage for an offline project', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    expect(getOfflineSkin).not.toHaveBeenCalled()
    expect(getOfflineSkinModel).not.toHaveBeenCalled()
    expect(getProfileSkin).not.toHaveBeenCalled()
    expect(skins.hasSkin.value).toBe(false)
  })

  it('revokes the pending preview url when the page unmounts mid-decode', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    let releaseBitmap: () => void = () => {}
    createImageBitmapMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseBitmap = resolve
      })
      return { width: 64, height: 64, close: () => {} }
    })
    const { result, unmount } = withSetup(() => useSkinSettings())
    await vi.waitFor(() => expect(getProfileSkin).toHaveBeenCalled())

    createObjectURLMock.mockReturnValueOnce('blob:pending')
    unmount()
    releaseBitmap()
    await flushPromises()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pending')
    expect(result.skinUrl.value).toBe('')
  })

  it('skips the upload without pending skin bytes', async () => {
    goOnline()
    vi.mocked(uploadSkin).mockResolvedValue(makeSkin(2))
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    await skins.handleUpload()

    expect(uploadSkin).not.toHaveBeenCalled()
  })

  it('rejects a renamed non-png skin before accepting the file', async () => {
    goOnline()
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    skins.selectSkin()
    const options = shared.selectFile.mock.calls[0]?.[0] as {
      onLoad: (file: { name: string }, result: string | ArrayBuffer) => Promise<void>
    }

    const fakePng = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x57, 0x45, 0x42, 0x50])
    await options.onLoad({ name: 'avatar.png' }, fakePng)

    expect(skins.errorMessage.value).toBe('Выбранный файл не является PNG-изображением')
    expect(skins.skinFileBytes.value.length).toBe(0)
    expect(createImageBitmapMock).not.toHaveBeenCalled()

    const realPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    await options.onLoad({ name: 'skin.png' }, realPng)

    expect(skins.errorMessage.value).toBe('')
    expect(skins.skinFileBytes.value).toEqual(realPng)
    expect(createImageBitmapMock).toHaveBeenCalledOnce()
  })

  it('keeps the manually selected model mode when the list reloads', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([{ ...makeSkin(1, true), model: 'slim' }])
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))
    expect(skins.modelMode.value).toBe('slim')

    skins.modelMode.value = 'classic'
    await skins.loadList()
    await nextTick()

    expect(skins.modelMode.value).toBe('classic')
  })

  it('adopts the model of the newly activated skin', async () => {
    goOnline()
    let activeId = 1
    vi.mocked(listSkins).mockImplementation(async () => [
      { ...makeSkin(1, activeId === 1), model: 'classic' },
      { ...makeSkin(2, activeId === 2), model: 'slim' },
    ])
    vi.mocked(setActiveSkin).mockImplementation(async (id: number): Promise<void> => {
      activeId = id
    })
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))
    expect(skins.modelMode.value).toBe('classic')

    await skins.handleActivate(2)
    await nextTick()

    expect(skins.modelMode.value).toBe('slim')
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

  it('resets the skin after confirmation without touching the offline storage', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).not.toBe(''))

    const confirmed = skins.resetSkin()
    useNotificationStore().resolvePopup(true)
    await confirmed

    expect(skins.hasSkin.value).toBe(false)
    expect(deleteOfflineSkin).not.toHaveBeenCalled()
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

  it('resets the preview and the list when the project switches', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    const core = useCoreStore()
    core.currentProject = 'proj'
    const skins = setupSkins()
    await vi.waitFor(() => expect(skins.skinUrl.value).toBe('blob:mock-url'))
    expect(skins.uploadedSkins.value).toHaveLength(1)

    core.currentProject = 'other'
    useAccountsStore().clearSessionState()
    await vi.waitFor(() => expect(skins.skinUrl.value).toBe(''))

    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
    expect(skins.uploadedSkins.value).toEqual([])
    expect(skins.listError.value).toBe('')
    expect(skins.isListLoading.value).toBe(false)
  })

  it('drops the stale preview response when the project switches mid-load', async () => {
    goOnline()
    vi.mocked(listSkins).mockResolvedValue([makeSkin(1, true)])
    let releaseBytes: (bytes: Uint8Array) => void = () => {}
    vi.mocked(getProfileSkin).mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          releaseBytes = resolve
        }),
    )
    const core = useCoreStore()
    core.currentProject = 'proj'
    const skins = setupSkins()
    await vi.waitFor(() => expect(getProfileSkin).toHaveBeenCalled())

    core.currentProject = 'other'
    useAccountsStore().clearSessionState()
    await nextTick()
    releaseBytes(new Uint8Array([1, 2, 3]))
    await vi.waitFor(() => expect(skins.isSkinLoading.value).toBe(false))

    expect(skins.skinUrl.value).toBe('')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('sets the texture load error through the composable action', async () => {
    const skins = setupSkins()

    expect(skins.errorMessage.value).toBe('')
    skins.setTextureError()

    expect(skins.errorMessage.value).toBe('Не удалось загрузить текстуру скина')
  })
})
