import { computed, ref, type ComputedRef } from 'vue'
import { getErrorMessage, getStartupLogs, listenGameConsole } from '@/06-shared/api'
import { createSingletonListeners, reportError } from '@/06-shared'
import type { ConsoleLog } from '@/05-entities'

const logs = ref<ConsoleLog[]>([])
const sessionLogs = ref<Record<string, ConsoleLog[]>>({})
const streamError = ref<string>('')
const LOG_LIMIT = 2000
const FLUSH_INTERVAL = 500
const FLUSH_BATCH = 100

const stripAnsi = (str: string): string => {
  return str
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

const cleanLog = (log: ConsoleLog): ConsoleLog => ({
  line: stripAnsi(log.line),
  isError: log.isError,
  session: log.session,
})

const isConsoleActive = ref<boolean>(false)
const rawBacklog: ConsoleLog[] = []
const consoleStreamListeners = createSingletonListeners()

let buffer: ConsoleLog[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

const capLines = (lines: ConsoleLog[]): void => {
  if (lines.length > LOG_LIMIT) {
    lines.splice(0, lines.length - LOG_LIMIT)
  }
}

const pushSessionLine = (log: ConsoleLog): void => {
  const name = log.session
  if (!name) return
  const existing = sessionLogs.value[name]
  const stream = existing ?? []
  stream.push(log)
  if (existing === undefined) sessionLogs.value[name] = stream
}

const dropSessionLines = (lines: ConsoleLog[], name: string): void => {
  const kept = lines.filter((log) => log.session !== name)
  lines.length = 0
  lines.push(...kept)
}

const scheduleFlush = (): void => {
  if (flushTimer !== null) return
  flushTimer = setTimeout((): void => {
    flushTimer = null
    flushBuffer()
    if (buffer.length > 0) scheduleFlush()
  }, FLUSH_INTERVAL)
}

const ingest = (log: ConsoleLog): void => {
  if (!isConsoleActive.value) {
    rawBacklog.push(log)
    capLines(rawBacklog)
    return
  }
  buffer.push(cleanLog(log))
  capLines(buffer)
  scheduleFlush()
}

const flushBuffer = (): number => {
  if (buffer.length === 0) return 0
  const count = Math.min(buffer.length, FLUSH_BATCH)
  const batch = buffer.splice(0, count)
  const touchedSessions = new Set<string>()
  for (const log of batch) {
    logs.value.push(log)
    pushSessionLine(log)
    if (log.session) touchedSessions.add(log.session)
  }
  capLines(logs.value)
  for (const name of touchedSessions) capLines(sessionLogs.value[name] ?? [])
  return count
}

const closeSession = (name: string): void => {
  dropSessionLines(buffer, name)
  dropSessionLines(rawBacklog, name)
  logs.value = logs.value.filter((log) => log.session !== name)
  delete sessionLogs.value[name]
}

export function useConsoleStream(): {
  logs: ComputedRef<ConsoleLog[]>
  sessionLogs: ComputedRef<Record<string, ConsoleLog[]>>
  streamError: ComputedRef<string>
  startConsoleStream: () => Promise<void>
  setConsoleActive: (active: boolean) => void
  closeSession: (name: string) => void
} {
  const startConsoleStream = async (): Promise<void> => {
    if (consoleStreamListeners.isStarted()) return
    streamError.value = ''

    try {
      await consoleStreamListeners.start(async (track): Promise<void> => {
        const liveDuringLoad: ConsoleLog[] = []
        let isStartupLoading = logs.value.length === 0
        track(
          await listenGameConsole((log): void => {
            if (isStartupLoading) {
              liveDuringLoad.push(log)
              return
            }
            ingest(log)
          }),
        )

        if (isStartupLoading) {
          const startupLogs: ConsoleLog[] = await getStartupLogs()
          for (const log of startupLogs) {
            ingest(log)
          }
          isStartupLoading = false
          for (const log of liveDuringLoad) {
            ingest(log)
          }
        }
      })
    } catch (e: unknown) {
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
      capLines(buffer)
    }
    flushBuffer()
    scheduleFlush()
  }

  return {
    logs: computed(() => logs.value),
    sessionLogs: computed(() => sessionLogs.value),
    streamError: computed(() => streamError.value),
    startConsoleStream,
    setConsoleActive,
    closeSession,
  }
}
