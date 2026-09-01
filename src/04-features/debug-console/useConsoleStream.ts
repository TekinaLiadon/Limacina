import { computed, ref, type ComputedRef } from 'vue'
import { getStartupLogs, listenGameConsole } from '@/06-shared/api'
import type { ConsoleLog } from '@/05-entities/core/types'

const logs = ref<ConsoleLog[]>([])
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

let streamingStarted = false
let buffer: ConsoleLog[] = []

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
  startConsoleStream: () => Promise<void>
} {
  const startConsoleStream = async (): Promise<void> => {
    if (streamingStarted) return
    streamingStarted = true

    try {
      if (logs.value.length === 0) {
        const startupLogs: ConsoleLog[] = await getStartupLogs()
        for (const log of startupLogs) {
          buffer.push(cleanLog(log))
        }
        flushBuffer()
      }

      await listenGameConsole((log: ConsoleLog) => {
        buffer.push(cleanLog(log))
      })

      setInterval(flushBuffer, FLUSH_INTERVAL)
    } catch (e: unknown) {
      streamingStarted = false
      console.error('Не удалось запустить стриминг консоли:', e)
    }
  }

  return {
    logs: computed(() => logs.value),
    startConsoleStream,
  }
}
