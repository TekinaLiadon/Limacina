import type { ComputedRef } from 'vue'
import { copyToClipboard } from '@/06-shared'
import { useConsoleStream } from '@/04-features/debug-console/useConsoleStream'
import type { ConsoleLog } from '@/05-entities/core/types'

export function useDebugConsole(): {
  logs: ComputedRef<ConsoleLog[]>
  handleCopy: () => Promise<void>
} {
  const { logs } = useConsoleStream()

  const handleCopy = async (): Promise<void> => {
    const text = logs.value.map((l) => l.line).join('\n')
    await copyToClipboard(text)
  }

  return {
    logs,
    handleCopy,
  }
}
