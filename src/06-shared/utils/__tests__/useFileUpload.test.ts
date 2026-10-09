import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectFile } from '../useFileUpload'

const onLoadMock = vi.fn()
const onErrorMock = vi.fn()

const pickFile = (file: File, readAs: 'arrayBuffer' | 'dataURL' = 'arrayBuffer'): void => {
  selectFile({
    accept: '.png,image/png',
    maxBytes: 256 * 1024,
    readAs,
    onError: onErrorMock,
    onLoad: onLoadMock,
  })
  if (!fileInput) throw new Error('file input was not created')
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  fileInput.onchange?.(new Event('change'))
}

let fileInput: HTMLInputElement | undefined

beforeEach(() => {
  fileInput = undefined
  onLoadMock.mockReset()
  onErrorMock.mockReset()
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName)
    if (tagName === 'input') fileInput = element as HTMLInputElement
    return element
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectFile', () => {
  it('rejects a file with a wrong extension', () => {
    pickFile(new File(['x'], 'skin.jpg', { type: 'image/jpeg' }))

    expect(onErrorMock).toHaveBeenCalledWith('Допустимый формат — .png,image/png')
    expect(onLoadMock).not.toHaveBeenCalled()
  })

  it('rejects a file over the size limit with the sizes in kb', () => {
    pickFile(new File(['x'.repeat(300 * 1024)], 'skin.png', { type: 'image/png' }))

    expect(onErrorMock).toHaveBeenCalledWith('Размер файла не должен превышать 256 КБ (загружено 300 КБ)')
    expect(onLoadMock).not.toHaveBeenCalled()
  })

  it('reads the file as an array buffer', async () => {
    pickFile(new File(['abc'], 'skin.png', { type: 'image/png' }))

    await vi.waitFor(() => expect(onLoadMock).toHaveBeenCalledTimes(1))

    const [file, result] = onLoadMock.mock.calls[0] ?? []
    expect(file?.name).toBe('skin.png')
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new TextDecoder().decode(result as ArrayBuffer)).toBe('abc')
  })

  it('reads the file as a data url by default', async () => {
    pickFile(new File(['abc'], 'skin.png'), 'dataURL')

    await vi.waitFor(() => expect(onLoadMock).toHaveBeenCalledTimes(1))

    const [, result] = onLoadMock.mock.calls[0] ?? []
    expect(typeof result).toBe('string')
    expect(String(result).startsWith('data:')).toBe(true)
  })

  it('reports an error when the read result is missing', () => {
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (
      this: FileReader,
    ) {
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
    })

    pickFile(new File(['abc'], 'skin.png', { type: 'image/png' }))

    expect(onErrorMock).toHaveBeenCalledWith('Не удалось прочитать файл')
    expect(onLoadMock).not.toHaveBeenCalled()
  })

  it('ignores the dialog when no file was chosen', () => {
    selectFile({
      accept: '.png',
      maxBytes: 256 * 1024,
      onError: onErrorMock,
      onLoad: onLoadMock,
    })
    if (!fileInput) throw new Error('file input was not created')
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true })
    fileInput.onchange?.(new Event('change'))

    expect(onLoadMock).not.toHaveBeenCalled()
    expect(onErrorMock).not.toHaveBeenCalled()
  })
})
