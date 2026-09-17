import { type Ref } from 'vue'
import { selectFile, useFileDrop } from '@/06-shared'
import { getErrorMessage } from '@/06-shared/api'

interface UserContentFileOptions {
  accept: string
  extensions: string[]
  maxBytes: number
  readFile: (path: string) => Promise<ArrayBuffer>
  processFile: (bytes: ArrayBuffer, name: string) => Promise<void>
  errorMessage: Ref<string>
}

export function useUserContentFile(options: UserContentFileOptions) {
  const loadFromPath = async (path: string): Promise<void> => {
    options.errorMessage.value = ''
    try {
      const bytes = await options.readFile(path)
      const name = path.split(/[\\/]/).pop() ?? path
      await options.processFile(bytes, name)
    } catch (e: unknown) {
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
          await options.processFile(result as ArrayBuffer, file.name)
        } catch (e: unknown) {
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
