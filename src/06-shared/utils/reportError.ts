import { sendConsoleLog } from '@/06-shared/api/consoleLog'

const DEDUP_WINDOW_MS = 5000
const MAX_SENDS_PER_WINDOW = 20

const formatErrorDetail = (error: unknown): string => {
  if (error === undefined) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

let lastLine = ''
let lastSentAt = 0
let windowStartedAt = 0
let windowSends = 0

export function reportError(message: string, error?: unknown): void {
  console.error(message, error)
  const now = Date.now()
  if (now - windowStartedAt >= DEDUP_WINDOW_MS) {
    windowStartedAt = now
    windowSends = 0
  }
  const detail = formatErrorDetail(error)
  const line = detail ? `[frontend] ${message}: ${detail}` : `[frontend] ${message}`
  if (line === lastLine && now - lastSentAt < DEDUP_WINDOW_MS) return
  if (windowSends >= MAX_SENDS_PER_WINDOW) return
  lastLine = line
  lastSentAt = now
  windowSends += 1
  sendConsoleLog(line, true).catch(() => {})
}
