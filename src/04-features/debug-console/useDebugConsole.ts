import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/05-entities'
import { getStartupLogs, listenGameConsole, copyToClipboard } from '@/06-shared/api'
import type { ConsoleLog } from '@/05-entities/core/types'
import type { UnlistenFn } from '@tauri-apps/api/event'

const logs = ref<ConsoleLog[]>([])
const LOG_LIMIT = 2000
export const FLUSH_INTERVAL = 500
export const FLUSH_BATCH = 100

const stripAnsi = (str: string): string => {
  return str
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\].*?\x07/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

const cleanLog = (log: ConsoleLog): ConsoleLog => ({
  line: stripAnsi(log.line),
  is_error: log.is_error,
})

let unlistenFn: UnlistenFn | null = null
let streamingStarted = false
let buffer: ConsoleLog[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

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

export function useDebugConsole() {
  const settingsStore = useSettingsStore()

  const initLogs = async (): Promise<void> => {
    if (logs.value.length === 0) {
      const startupLogs: ConsoleLog[] = await getStartupLogs()
      for (const log of startupLogs) {
        buffer.push(cleanLog(log))
      }
      flushBuffer()
    }
  }

  const startStreaming = async (): Promise<void> => {
    if (streamingStarted) return
    streamingStarted = true

    unlistenFn = await listenGameConsole((log: ConsoleLog) => {
      buffer.push(cleanLog(log))
    })

    flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL)
  }

  const stopStreaming = (): void => {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    if (unlistenFn) {
      unlistenFn()
      unlistenFn = null
    }
    flushBuffer()
    streamingStarted = false
  }

  const handleCopy = async (): Promise<void> => {
    const text = logs.value.map((l) => l.line).join('\n')
    await copyToClipboard(text)
  }

  onMounted(async (): Promise<void> => {
    await initLogs()
    await startStreaming()
  })

  onUnmounted((): void => {
    stopStreaming()
  })

  return {
    logs: computed(() => logs.value),
    settingsStore,
    handleCopy,
  }
}
