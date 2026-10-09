interface FileUploadOptions {
  accept: string
  maxBytes: number
  readAs?: 'dataURL' | 'arrayBuffer'
  onError: (message: string) => void
  onLoad: (file: File, result: string | ArrayBuffer) => void
}

export function fileSizeLimitMessage(maxBytes: number, sizeBytes: number): string {
  const maxKb = Math.round(maxBytes / 1024)
  const sizeKb = Math.round(sizeBytes / 1024)
  return `Размер файла не должен превышать ${maxKb} КБ (загружено ${sizeKb} КБ)`
}

export function selectFile(options: FileUploadOptions): void {
  const { accept, maxBytes, readAs = 'dataURL', onError, onLoad } = options

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept

  input.onchange = (): void => {
    const file = input.files?.[0]
    if (!file) return

    const ext = accept.split(',').map(s => s.trim().replace('.', ''))
    const fileExt = file.name.split('.').pop()?.toLowerCase() || ''
    if (!ext.includes(fileExt)) {
      onError(`Допустимый формат — ${accept}`)
      return
    }

    if (file.size > maxBytes) {
      onError(fileSizeLimitMessage(maxBytes, file.size))
      return
    }

    const reader = new FileReader()
    reader.onload = (): void => {
      if (reader.result === null) {
        onError('Не удалось прочитать файл')
        return
      }
      onLoad(file, reader.result)
    }
    reader.onerror = () => {
      onError('Не удалось прочитать файл')
    }

    if (readAs === 'arrayBuffer') {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsDataURL(file)
    }
  }

  input.click()
}
