import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { copyToClipboard } from '@/06-shared'
import { useConsoleStream } from '@/04-features/debug-console/useConsoleStream'
import type { ConsoleLog } from '@/05-entities/core/types'

export function useDebugConsole(): {
  logs: ComputedRef<ConsoleLog[]>
  filteredLogs: ComputedRef<ConsoleLog[]>
  searchQuery: Ref<string>
  onlyErrors: Ref<boolean>
  linesCount: ComputedRef<number>
  handleCopy: () => Promise<void>
} {
  const { logs, setConsoleActive } = useConsoleStream()

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
    await copyToClipboard(text)
  }

  return {
    logs,
    filteredLogs,
    searchQuery,
    onlyErrors,
    linesCount,
    handleCopy,
  }
}
