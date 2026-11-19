import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { installFiguraAvatar, readFiguraArchive } from '@/06-shared/api'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { useFiguraAvatarUpload } from '../useFiguraAvatarUpload'
import { withSetup } from '@/test-support/withSetup'

const shared = vi.hoisted(() => ({
  selectFile: vi.fn(),
}))

const dropHandler = vi.hoisted(() => ({
  current: undefined as ((event: unknown) => void) | undefined,
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  selectFile: shared.selectFile,
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  readFiguraArchive: vi.fn(),
  installFiguraAvatar: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: (): unknown => ({
    onDragDropEvent: async (callback: (event: unknown) => void): Promise<() => void> => {
      dropHandler.current = callback
      return (): void => {}
    },
  }),
}))

vi.mock('@/06-shared/utils/reportError', () => ({ reportError: vi.fn() }))

const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
const DROPPED_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])

const EXISTS_ERROR = {
  code: 'figura_avatar_exists',
  message: 'Аватар Figura «Hecate» уже существует',
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

interface DialogOptions {
  accept: string
  maxBytes: number
  readAs: string
  onLoad: (file: { name: string }, result: string | ArrayBuffer) => Promise<void>
  onError: (message: string) => void
}

interface UploadSetup {
  upload: ReturnType<typeof useFiguraAvatarUpload>
  onInstalled: ReturnType<typeof vi.fn>
  unmount: () => void
}

const setupUpload = (): UploadSetup => {
  const onInstalled = vi.fn()
  const { result, unmount } = withSetup(() => useFiguraAvatarUpload({ onInstalled }))
  return { upload: result, onInstalled, unmount }
}

const lastDialogOptions = (): DialogOptions => {
  const { calls } = shared.selectFile.mock
  const options = calls[calls.length - 1]?.[0] as DialogOptions | undefined
  if (options === undefined) throw new Error('диалог выбора файла не открывался')
  return options
}

const pickArchive = async (setup: UploadSetup, name: string, bytes: Uint8Array = ZIP_BYTES): Promise<void> => {
  setup.upload.openArchiveDialog()
  await lastDialogOptions().onLoad({ name }, toArrayBuffer(bytes))
  await flushPromises()
}

const dropArchive = async (path: string): Promise<void> => {
  await vi.waitFor(() => {
    if (dropHandler.current === undefined) throw new Error('слушатель дропа не поставлен')
  })
  dropHandler.current?.({ payload: { type: 'drop', paths: [path] } })
  await flushPromises()
}

const setProject = (name: string): void => {
  useCoreStore().currentProject = name
}

beforeEach(() => {
  setActivePinia(createPinia())
  shared.selectFile.mockReset()
  dropHandler.current = undefined
  vi.mocked(readFiguraArchive).mockReset()
  vi.mocked(installFiguraAvatar).mockReset()
  vi.mocked(installFiguraAvatar).mockResolvedValue(undefined)
  setProject('Cordelia')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFiguraAvatarUpload dialog', () => {
  it('installs the archive under the file name without overwrite', async () => {
    const setup = setupUpload()

    await pickArchive(setup, 'Hecate.zip')

    expect(installFiguraAvatar).toHaveBeenCalledWith('Cordelia', 'Hecate', false, ZIP_BYTES)
    expect(setup.onInstalled).toHaveBeenCalledWith('Hecate')
    expect(setup.upload.installError.value).toBe('')
    expect(setup.upload.isInstalling.value).toBe(false)
    expect(useNotificationStore().message).not.toBe('')
  })

  it('strips the zip extension and keeps inner dots in the avatar name', async () => {
    const setup = setupUpload()

    await pickArchive(setup, 'Hecate.v2.ZIP')

    expect(installFiguraAvatar).toHaveBeenCalledWith('Cordelia', 'Hecate.v2', false, ZIP_BYTES)
  })

  it('asks before replacing an existing avatar and retries with overwrite', async () => {
    vi.mocked(installFiguraAvatar)
      .mockRejectedValueOnce(EXISTS_ERROR)
      .mockResolvedValueOnce(undefined)
    const setup = setupUpload()
    const notification = useNotificationStore()

    setup.upload.openArchiveDialog()
    const pending = lastDialogOptions().onLoad({ name: 'Hecate.zip' }, toArrayBuffer(ZIP_BYTES))
    await vi.waitFor(() => {
      expect(notification.popupVisible).toBe(true)
    })
    expect(notification.popupMessage).toContain('Hecate')

    notification.resolvePopup(true)
    await pending

    expect(installFiguraAvatar).toHaveBeenCalledTimes(2)
    expect(vi.mocked(installFiguraAvatar).mock.calls[1]).toEqual(['Cordelia', 'Hecate', true, ZIP_BYTES])
    expect(setup.onInstalled).toHaveBeenCalledWith('Hecate')
    expect(setup.upload.installError.value).toBe('')
  })

  it('keeps the existing avatar when the replacement is declined', async () => {
    vi.mocked(installFiguraAvatar).mockRejectedValueOnce(EXISTS_ERROR)
    const setup = setupUpload()
    const notification = useNotificationStore()

    setup.upload.openArchiveDialog()
    const pending = lastDialogOptions().onLoad({ name: 'Hecate.zip' }, toArrayBuffer(ZIP_BYTES))
    await vi.waitFor(() => {
      expect(notification.popupVisible).toBe(true)
    })

    notification.resolvePopup(false)
    await pending

    expect(installFiguraAvatar).toHaveBeenCalledTimes(1)
    expect(setup.onInstalled).not.toHaveBeenCalled()
    expect(setup.upload.installError.value).toBe('')
    expect(setup.upload.isInstalling.value).toBe(false)
  })

  it('rejects a file that is not a zip archive without calling the backend', async () => {
    const setup = setupUpload()

    await pickArchive(setup, 'Hecate.zip', new TextEncoder().encode('not a zip'))

    expect(installFiguraAvatar).not.toHaveBeenCalled()
    expect(setup.upload.installError.value).toContain('ZIP')
    expect(setup.onInstalled).not.toHaveBeenCalled()
  })

  it('rejects an archive whose name is not a valid avatar name', async () => {
    const setup = setupUpload()

    await pickArchive(setup, 'bad:name.zip')

    expect(installFiguraAvatar).not.toHaveBeenCalled()
    expect(setup.upload.installError.value).not.toBe('')
  })

  it('reports a backend failure in the panel error slot', async () => {
    vi.mocked(installFiguraAvatar).mockRejectedValue(new Error('Не удалось распаковать архив аватара'))
    const setup = setupUpload()

    await pickArchive(setup, 'Hecate.zip')

    expect(setup.upload.installError.value).toBe('Не удалось распаковать архив аватара')
    expect(setup.onInstalled).not.toHaveBeenCalled()
    expect(setup.upload.isInstalling.value).toBe(false)
  })

  it('skips the install when no project is selected', async () => {
    setProject('')
    const setup = setupUpload()

    await pickArchive(setup, 'Hecate.zip')

    expect(installFiguraAvatar).not.toHaveBeenCalled()
    expect(setup.upload.installError.value).not.toBe('')
  })
})

describe('useFiguraAvatarUpload drop', () => {
  it('reads a dropped archive through the path command and installs it', async () => {
    vi.mocked(readFiguraArchive).mockResolvedValue(DROPPED_ZIP)
    const setup = setupUpload()

    await dropArchive('/models/Hecate.zip')
    await vi.waitFor(() => {
      expect(setup.onInstalled).toHaveBeenCalledWith('Hecate')
    })

    expect(readFiguraArchive).toHaveBeenCalledWith('/models/Hecate.zip')
    expect(installFiguraAvatar).toHaveBeenCalledWith('Cordelia', 'Hecate', false, DROPPED_ZIP)
  })

  it('reports a non-archive drop through the common format message', async () => {
    const setup = setupUpload()

    await dropArchive('/models/avatar.bbmodel')
    await vi.waitFor(() => {
      expect(setup.upload.installError.value).toContain('.zip')
    })

    expect(readFiguraArchive).not.toHaveBeenCalled()
  })

  it('reports a failed archive read without installing', async () => {
    vi.mocked(readFiguraArchive).mockRejectedValue(new Error('Ошибка файловой системы'))
    const setup = setupUpload()

    await dropArchive('/models/Hecate.zip')
    await vi.waitFor(() => {
      expect(setup.upload.installError.value).toContain('Ошибка файловой системы')
    })

    expect(installFiguraAvatar).not.toHaveBeenCalled()
  })
})
