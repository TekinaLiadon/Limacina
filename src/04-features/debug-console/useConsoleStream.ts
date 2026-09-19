import { computed, ref, type ComputedRef } from 'vue'
import { getErrorMessage, getStartupLogs, listenGameConsole } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import type { ConsoleLog } from '@/05-entities'

const logs = ref<ConsoleLog[]>([])
const streamError = ref<string>('')
const LOG_LIMIT = 2000
const FLUSH_INTERVAL = 500
const FLUSH_BATCH = 100

const stripAnsi = (str: string): string => {
  return str
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\].*?\x07/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

const cleanLog = (log: ConsoleLog): ConsoleLog => ({
  line: stripAnsi(log.line),
  isError: log.isError,
})

const isConsoleActive = ref<boolean>(false)
const rawBacklog: ConsoleLog[] = []

let streamingStarted = false
let buffer: ConsoleLog[] = []

const ingest = (log: ConsoleLog): void => {
  if (!isConsoleActive.value) {
    rawBacklog.push(log)
    if (rawBacklog.length > LOG_LIMIT) {
      rawBacklog.splice(0, rawBacklog.length - LOG_LIMIT)
    }
    return
  }
  buffer.push(cleanLog(log))
}

const flushBuffer = (): number => {
  if (buffer.length === 0) return 0
  const count = Math.min(buffer.length, FLUSH_BATCH)
  const batch = buffer.splice(0, count)
  logs.value.push(...batch)
  if (logs.value.length > LOG_LIMIT) {
    logs.value.splice(0, logs.value.length - LOG_LIMIT)
  }
  return count
}

export function useConsoleStream(): {
  logs: ComputedRef<ConsoleLog[]>
  streamError: ComputedRef<string>
  startConsoleStream: () => Promise<void>
  setConsoleActive: (active: boolean) => void
} {
  const startConsoleStream = async (): Promise<void> => {
    if (streamingStarted) return
    streamingStarted = true
    streamError.value = ''

    try {
      if (logs.value.length === 0) {
        const startupLogs: ConsoleLog[] = await getStartupLogs()
        for (const log of startupLogs) {
          ingest(log)
        }
        flushBuffer()
      }

      await listenGameConsole(ingest)

      setInterval(flushBuffer, FLUSH_INTERVAL)
    } catch (e: unknown) {
      streamingStarted = false
      streamError.value = getErrorMessage(e)
      reportError('Не удалось запустить стриминг консоли', e)
    }
  }

  const setConsoleActive = (active: boolean): void => {
    isConsoleActive.value = active
    if (!active) return
    if (rawBacklog.length > 0) {
      for (const log of rawBacklog) {
        buffer.push(cleanLog(log))
      }
      rawBacklog.length = 0
    }
    flushBuffer()
  }

  return {
    logs: computed(() => logs.value),
    streamError: computed(() => streamError.value),
    startConsoleStream,
    setConsoleActive,
  }
}
