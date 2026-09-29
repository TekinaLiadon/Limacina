import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { reportError } from './reportError'

interface FileDropOptions {
  accept: readonly string[]
  onDrop: (path: string) => void
  onError: (message: string) => void
}

const hasAcceptedExtension = (path: string, accept: readonly string[]): boolean => {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return accept.some((item) => item.toLowerCase() === extension)
}

export function useFileDrop(options: FileDropOptions): { isDragOver: Ref<boolean> } {
  const isDragOver = ref<boolean>(false)
  let unlisten: (() => void) | null = null
  let disposed = false

  onMounted(async (): Promise<void> => {
    try {
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        const { payload } = event
        if (payload.type === 'enter') {
          if (payload.paths.some((path) => hasAcceptedExtension(path, options.accept))) {
            isDragOver.value = true
          }
          return
        }
        if (payload.type === 'leave') {
          isDragOver.value = false
          return
        }
        if (payload.type === 'drop') {
          isDragOver.value = false
          const acceptedPath = payload.paths.find((path) => hasAcceptedExtension(path, options.accept))
          if (acceptedPath !== undefined) {
            options.onDrop(acceptedPath)
            return
          }
          if (payload.paths.length > 0) {
            options.onError(`Допустимый формат — .${options.accept.join(', .')}`)
          }
        }
      })
      if (disposed) {
        stop()
        return
      }
      unlisten = stop
    } catch (e: unknown) {
      reportError('Не удалось включить приём файлов перетаскиванием', e)
    }
  })

  onBeforeUnmount((): void => {
    disposed = true
    if (unlisten !== null) unlisten()
  })

  return { isDragOver }
}
