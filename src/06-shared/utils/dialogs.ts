import { open } from '@tauri-apps/plugin-dialog'
import { reportError } from './reportError'

export async function selectDirectory(): Promise<string | null> {
  try {
    return await open({ directory: true })
  } catch (e: unknown) {
    reportError('Не удалось открыть диалог выбора папки', e)
    return null
  }
}
