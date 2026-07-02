import { computed, onMounted, onUnmounted } from 'vue'
import { useCoreStore, useSettingsStore } from '@/05-entities'
import { getStartupLogs, listenGameConsole, copyToClipboard } from '@/06-shared/api'
import type { ConsoleLog } from '@/05-entities/core/types'
import type { UnlistenFn } from '@tauri-apps/api/event'

export function useDebugConsole() {
  const coreStore = useCoreStore()
  const settingsStore = useSettingsStore()
  const logLimit = 5000
  let unlistenFn: UnlistenFn | null = null
  let initialized = false

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

  const initLogs = async (): Promise<void> => {
    if (!initialized && coreStore.debugLogs.length === 0) {
      const startupLogs: ConsoleLog[] = await getStartupLogs()
      for (const log of startupLogs) {
        coreStore.debugLogs.push(cleanLog(log))
      }
    }
    initialized = true
  }

  const startStreaming = async (): Promise<void> => {
    const unlisten: UnlistenFn = await listenGameConsole((log: ConsoleLog) => {
      coreStore.debugLogs.push(cleanLog(log))
      if (coreStore.debugLogs.length > logLimit) {
        coreStore.debugLogs.splice(0, coreStore.debugLogs.length - logLimit)
      }
    })
    unlistenFn = unlisten
  }

  const handleCopy = async (): Promise<void> => {
    const text = coreStore.debugLogs.map((l) => l.line).join('\n')
    await copyToClipboard(text)
  }

  onMounted(async (): Promise<void> => {
    await initLogs()
    await startStreaming()
  })

  onUnmounted((): void => {
    if (unlistenFn) unlistenFn()
  })

  return {
    logs: computed(() => coreStore.debugLogs),
    settingsStore,
    handleCopy,
  }
}
