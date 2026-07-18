interface FileUploadOptions {
  accept: string
  maxBytes: number
  readAs?: 'dataURL' | 'arrayBuffer'
  onError: (message: string) => void
  onLoad: (file: File, result: string | ArrayBuffer) => void
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
      const maxKb = Math.round(maxBytes / 1024)
      const fileSizeKb = Math.round(file.size / 1024)
      onError(`Размер файла не должен превышать ${maxKb} КБ (загружено ${fileSizeKb} КБ)`)
      return
    }

    const reader = new FileReader()
    reader.onload = (): void => {
      onLoad(file, reader.result!)
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
