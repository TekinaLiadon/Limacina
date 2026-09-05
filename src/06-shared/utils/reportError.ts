import { sendConsoleLog } from '@/06-shared/api'

const formatErrorDetail = (error: unknown): string => {
  if (error === undefined) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

export function reportError(message: string, error?: unknown): void {
  console.error(message, error)
  const detail = formatErrorDetail(error)
  const line = detail ? `[frontend] ${message}: ${detail}` : `[frontend] ${message}`
  sendConsoleLog(line, true).catch(() => {})
}
