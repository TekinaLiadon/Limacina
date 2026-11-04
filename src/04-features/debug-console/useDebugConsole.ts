import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { copyToClipboard, reportError } from '@/06-shared'
import { useConsoleStream } from '@/04-features/debug-console/useConsoleStream'
import { useLaunchStore, useNotificationStore, type ConsoleLog } from '@/05-entities'

export interface ConsoleSessionTab {
  name: string
  isLive: boolean
}

export function useDebugConsole(): {
  logs: ComputedRef<ConsoleLog[]>
  sessionTabs: ComputedRef<ConsoleSessionTab[]>
  activeSession: Ref<string | null>
  activeLogs: ComputedRef<ConsoleLog[]>
  filteredLogs: ComputedRef<ConsoleLog[]>
  searchQuery: Ref<string>
  onlyErrors: Ref<boolean>
  linesCount: ComputedRef<number>
  streamError: ComputedRef<string>
  startConsoleStream: () => Promise<void>
  handleCopy: () => Promise<void>
  closeSession: (name: string) => void
} {
  const { logs, sessionLogs, streamError, startConsoleStream, setConsoleActive, closeSession: closeSessionStream } =
    useConsoleStream()
  const notification = useNotificationStore()
  const launchStore = useLaunchStore()

  const searchQuery = ref<string>('')
  const onlyErrors = ref<boolean>(false)
  const activeSession = ref<string | null>(null)

  const sessionTabs = computed((): ConsoleSessionTab[] => {
    const names: string[] = []
    for (const log of logs.value) {
      if (log.session && !names.includes(log.session)) names.push(log.session)
    }
    for (const name of launchStore.gameUsernames) {
      if (!names.includes(name)) names.push(name)
    }
    return names.map((name) => ({ name, isLive: launchStore.gameUsernames.includes(name) }))
  })

  const activeLogs = computed((): ConsoleLog[] => {
    if (activeSession.value === null) return logs.value
    return sessionLogs.value[activeSession.value] ?? []
  })

  const filteredLogs = computed((): ConsoleLog[] => {
    const query = searchQuery.value.trim().toLowerCase()
    return activeLogs.value.filter((log) => {
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

  const closeSession = (name: string): void => {
    closeSessionStream(name)
    if (activeSession.value === name) activeSession.value = null
  }

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
    sessionTabs,
    activeSession,
    activeLogs,
    filteredLogs,
    searchQuery,
    onlyErrors,
    linesCount,
    streamError,
    startConsoleStream,
    handleCopy,
    closeSession,
  }
}
