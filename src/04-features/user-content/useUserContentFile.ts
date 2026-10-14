import { type Ref } from 'vue'
import { reportError, selectFile, useFileDrop, fileSizeLimitMessage } from '@/06-shared'
import { getErrorMessage } from '@/06-shared/api'

interface UserContentFileOptions {
  accept: string
  extensions: string[]
  maxBytes: number
  readFile: (path: string) => Promise<Uint8Array>
  processFile: (bytes: Uint8Array, name: string) => Promise<void>
  validateBytes?: ((bytes: Uint8Array, name: string) => string | null) | undefined
  errorMessage: Ref<string>
}

export function useUserContentFile(options: UserContentFileOptions) {
  const loadFromPath = async (path: string): Promise<void> => {
    options.errorMessage.value = ''
    try {
      const bytes = await options.readFile(path)
      if (bytes.byteLength > options.maxBytes) {
        options.errorMessage.value = fileSizeLimitMessage(options.maxBytes, bytes.byteLength)
        return
      }
      const name = path.split(/[\\/]/).pop() ?? path
      const invalidMessage = options.validateBytes?.(bytes, name) ?? null
      if (invalidMessage !== null) {
        options.errorMessage.value = invalidMessage
        return
      }
      await options.processFile(bytes, name)
    } catch (e: unknown) {
      reportError('Не удалось прочитать файл', e)
      options.errorMessage.value = getErrorMessage(e)
    }
  }

  const openFileDialog = (): void => {
    options.errorMessage.value = ''
    selectFile({
      accept: options.accept,
      maxBytes: options.maxBytes,
      readAs: 'arrayBuffer',
      onError: (message: string): void => {
        options.errorMessage.value = message
      },
      onLoad: async (file: File, result: string | ArrayBuffer): Promise<void> => {
        try {
          const bytes = new Uint8Array(result as ArrayBuffer)
          const invalidMessage = options.validateBytes?.(bytes, file.name) ?? null
          if (invalidMessage !== null) {
            options.errorMessage.value = invalidMessage
            return
          }
          options.errorMessage.value = ''
          await options.processFile(bytes, file.name)
        } catch (e: unknown) {
          reportError('Не удалось обработать файл', e)
          options.errorMessage.value = getErrorMessage(e)
        }
      },
    })
  }

  const { isDragOver } = useFileDrop({
    accept: options.extensions,
    onDrop: (path: string): void => {
      void loadFromPath(path)
    },
    onError: (message: string): void => {
      options.errorMessage.value = message
    },
  })

  return { isDragOver, openFileDialog, loadFromPath }
}
