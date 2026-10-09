import { invoke } from '@tauri-apps/api/core'

export async function sendConsoleLog(line: string, isError: boolean): Promise<void> {
  return invoke('send_frontend_log', { line, isError })
}
