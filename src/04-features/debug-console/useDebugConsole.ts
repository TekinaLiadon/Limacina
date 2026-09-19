import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { copyToClipboard, reportError } from '@/06-shared'
import { useConsoleStream } from '@/04-features/debug-console/useConsoleStream'
import { useNotificationStore, type ConsoleLog } from '@/05-entities'

export function useDebugConsole(): {
  logs: ComputedRef<ConsoleLog[]>
  filteredLogs: ComputedRef<ConsoleLog[]>
  searchQuery: Ref<string>
  onlyErrors: Ref<boolean>
  linesCount: ComputedRef<number>
  streamError: ComputedRef<string>
  startConsoleStream: () => Promise<void>
  handleCopy: () => Promise<void>
} {
  const { logs, streamError, startConsoleStream, setConsoleActive } = useConsoleStream()
  const notification = useNotificationStore()

  const searchQuery = ref<string>('')
  const onlyErrors = ref<boolean>(false)

  const filteredLogs = computed((): ConsoleLog[] => {
    const query = searchQuery.value.trim().toLowerCase()
    return logs.value.filter((log) => {
      if (onlyErrors.value && !log.isError) return false
      if (query && !log.line.toLowerCase().includes(query)) return false
      return true
    })
  })

  const linesCount = computed((): number => filteredLogs.value.length)

  onMounted((): void => {
    setConsoleActive(true)
  })

  onUnmounted((): void => {
    setConsoleActive(false)
  })

  const handleCopy = async (): Promise<void> => {
    const text = filteredLogs.value.map((l) => l.line).join('\n')
    try {
      await copyToClipboard(text)
    } catch (e: unknown) {
      reportError('Не удалось скопировать логи', e)
      notification.show('Не удалось скопировать логи')
    }
  }

  return {
    logs,
    filteredLogs,
    searchQuery,
    onlyErrors,
    linesCount,
    streamError,
    startConsoleStream,
    handleCopy,
  }
}
