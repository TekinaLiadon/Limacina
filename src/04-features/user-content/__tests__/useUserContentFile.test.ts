import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { useUserContentFile } from '../useUserContentFile'
import { hasPngSignature } from '@/06-shared'
import { withSetup } from '@/test-support/withSetup'

const shared = vi.hoisted(() => ({
  selectFile: vi.fn(),
  useFileDrop: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  selectFile: shared.selectFile,
  useFileDrop: shared.useFileDrop,
}))

describe('useUserContentFile', () => {
  const readFile = vi.fn<(path: string) => Promise<Uint8Array>>()
  const processFile = vi.fn<(bytes: Uint8Array, name: string) => Promise<void>>()
  const errorMessage = ref('')

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    readFile.mockReset()
    processFile.mockReset()
    errorMessage.value = ''
    shared.selectFile.mockReset()
    shared.useFileDrop.mockReset()
    shared.useFileDrop.mockImplementation((): { isDragOver: Ref<boolean> } => ({
      isDragOver: ref(false),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupFile = (): ReturnType<typeof useUserContentFile> => {
    return setupWithLimits({ accept: '.cpmproject', extensions: ['cpmproject'], maxBytes: 1024 })
  }

  const setupWithLimits = (options: {
    accept: string
    extensions: string[]
    maxBytes: number
    validateBytes?: (bytes: Uint8Array, name: string) => string | null
  }): ReturnType<typeof useUserContentFile> => {
    const { result } = withSetup(() =>
      useUserContentFile({
        accept: options.accept,
        extensions: options.extensions,
        maxBytes: options.maxBytes,
        readFile,
        processFile,
        validateBytes: options.validateBytes,
        errorMessage,
      }),
    )
    return result
  }

  it('reads the file from a path and passes the basename', async () => {
    const bytes = new Uint8Array(4)
    readFile.mockResolvedValue(bytes)
    const file = setupFile()

    await file.loadFromPath('/models/hero.cpmproject')

    expect(readFile).toHaveBeenCalledWith('/models/hero.cpmproject')
    expect(processFile).toHaveBeenCalledWith(bytes, 'hero.cpmproject')
    expect(errorMessage.value).toBe('')
  })

  it('splits windows paths into the basename', async () => {
    readFile.mockResolvedValue(new Uint8Array(4))
    const file = setupFile()

    await file.loadFromPath('C:\\Games\\skin.png')

    expect(processFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'skin.png')
  })

  it('reports the read failure', async () => {
    readFile.mockRejectedValue(new Error('file gone'))
    const file = setupFile()

    await file.loadFromPath('/models/hero.cpmproject')

    expect(errorMessage.value).toBe('file gone')
    expect(processFile).not.toHaveBeenCalled()
  })

  it('reports the processing failure', async () => {
    readFile.mockResolvedValue(new Uint8Array(4))
    processFile.mockRejectedValue(new Error('bad archive'))
    const file = setupFile()

    await file.loadFromPath('/models/hero.cpmproject')

    expect(errorMessage.value).toBe('bad archive')
  })

  it('opens the dialog with the accepted extensions and caps', () => {
    const file = setupFile()

    file.openFileDialog()

    expect(shared.selectFile).toHaveBeenCalledWith(
      expect.objectContaining({
        accept: '.cpmproject',
        maxBytes: 1024,
        readAs: 'arrayBuffer',
      }),
    )
  })

  it('processes the picked file through the dialog callback', async () => {
    const file = setupFile()
    file.openFileDialog()
    const options = shared.selectFile.mock.calls[0]?.[0] as {
      onLoad: (file: { name: string }, result: string | ArrayBuffer) => Promise<void>
      onError: (message: string) => void
    }

    const bytes = new Uint8Array(4)
    await options.onLoad({ name: 'hero.cpmproject' }, bytes)

    expect(processFile).toHaveBeenCalledWith(bytes, 'hero.cpmproject')

    processFile.mockRejectedValueOnce(new Error('bad archive'))
    await options.onLoad({ name: 'hero.cpmproject' }, bytes)
    expect(errorMessage.value).toBe('bad archive')
  })

  it('surfaces the dialog-level error', () => {
    const file = setupFile()
    file.openFileDialog()
    const options = shared.selectFile.mock.calls[0]?.[0] as {
      onError: (message: string) => void
    }

    options.onError('Допустимый формат — .cpmproject')

    expect(errorMessage.value).toBe('Допустимый формат — .cpmproject')
  })

  it('routes the drop event through the same load path', async () => {
    readFile.mockResolvedValue(new Uint8Array(4))
    setupFile()
    await vi.waitFor(() => expect(shared.useFileDrop).toHaveBeenCalledTimes(1))
    const dropOptions = shared.useFileDrop.mock.calls[0]?.[0] as {
      accept: string[]
      onDrop: (path: string) => void
    }

    expect(dropOptions.accept).toEqual(['cpmproject'])
    dropOptions.onDrop('/models/dropped.cpmproject')
    await vi.waitFor(() => expect(processFile).toHaveBeenCalled())

    expect(processFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'dropped.cpmproject')
  })

  it('rejects a path file above the limit with the dialog message', async () => {
    readFile.mockResolvedValue(new Uint8Array(2048))
    const file = setupFile()

    await file.loadFromPath('/models/hero.cpmproject')

    expect(errorMessage.value).toBe('Размер файла не должен превышать 1 КБ (загружено 2 КБ)')
    expect(processFile).not.toHaveBeenCalled()
  })

  it('accepts a path file at exactly the limit', async () => {
    readFile.mockResolvedValue(new Uint8Array(1024))
    const file = setupFile()

    await file.loadFromPath('/models/hero.cpmproject')

    expect(errorMessage.value).toBe('')
    expect(processFile).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized skin from a path with the dialog message', async () => {
    readFile.mockResolvedValue(new Uint8Array(300 * 1024))
    const file = setupWithLimits({ accept: '.png,image/png', extensions: ['png'], maxBytes: 256 * 1024 })

    await file.loadFromPath('/skins/heavy.png')

    expect(errorMessage.value).toBe('Размер файла не должен превышать 256 КБ (загружено 300 КБ)')
    expect(processFile).not.toHaveBeenCalled()
  })

  it('rejects an oversized cpm project from a path with the dialog message', async () => {
    readFile.mockResolvedValue(new Uint8Array(3 * 1024 * 1024))
    const file = setupWithLimits({ accept: '.cpmproject', extensions: ['cpmproject'], maxBytes: 2 * 1024 * 1024 })

    await file.loadFromPath('/models/hero.cpmproject')

    expect(errorMessage.value).toBe('Размер файла не должен превышать 2048 КБ (загружено 3072 КБ)')
    expect(processFile).not.toHaveBeenCalled()
  })

  it('rejects an oversized dropped file with the dialog message', async () => {
    readFile.mockResolvedValue(new Uint8Array(2048))
    setupFile()
    await vi.waitFor(() => expect(shared.useFileDrop).toHaveBeenCalledTimes(1))
    const dropOptions = shared.useFileDrop.mock.calls[0]?.[0] as {
      onDrop: (path: string) => void
    }

    dropOptions.onDrop('/models/dropped.cpmproject')
    await vi.waitFor(() => expect(errorMessage.value).not.toBe(''))

    expect(errorMessage.value).toBe('Размер файла не должен превышать 1 КБ (загружено 2 КБ)')
    expect(processFile).not.toHaveBeenCalled()
  })

  it('rejects bytes failing validation before processing from a path', async () => {
    const fakePng = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    readFile.mockResolvedValue(fakePng)
    const file = setupWithLimits({
      accept: '.png,image/png',
      extensions: ['png'],
      maxBytes: 1024,
      validateBytes: (bytes: Uint8Array): string | null =>
        hasPngSignature(bytes) ? null : 'Выбранный файл не является PNG-изображением',
    })

    await file.loadFromPath('/skins/avatar.png')

    expect(errorMessage.value).toBe('Выбранный файл не является PNG-изображением')
    expect(processFile).not.toHaveBeenCalled()
  })

  it('rejects bytes failing validation before processing from the dialog', async () => {
    const file = setupWithLimits({
      accept: '.png,image/png',
      extensions: ['png'],
      maxBytes: 1024,
      validateBytes: (bytes: Uint8Array): string | null =>
        hasPngSignature(bytes) ? null : 'Выбранный файл не является PNG-изображением',
    })
    file.openFileDialog()
    const options = shared.selectFile.mock.calls[0]?.[0] as {
      onLoad: (file: { name: string }, result: string | ArrayBuffer) => Promise<void>
    }

    const realPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    await options.onLoad({ name: 'avatar.png' }, realPng)
    expect(processFile).toHaveBeenCalledWith(realPng, 'avatar.png')
    expect(errorMessage.value).toBe('')

    const fakePng = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50])
    await options.onLoad({ name: 'renamed.png' }, fakePng)
    expect(errorMessage.value).toBe('Выбранный файл не является PNG-изображением')
    expect(processFile).toHaveBeenCalledTimes(1)
  })
})
