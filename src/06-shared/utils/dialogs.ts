import { open, save } from '@tauri-apps/plugin-dialog'
import { reportError } from './reportError'

export async function selectDirectory(): Promise<string | null> {
  try {
    return await open({ directory: true })
  } catch (e: unknown) {
    reportError('Не удалось открыть диалог выбора папки', e)
    return null
  }
}

export interface SaveFileOptions {
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

export async function saveFile(options: SaveFileOptions): Promise<string | null> {
  try {
    return await save({ defaultPath: options.defaultPath, filters: options.filters })
  } catch (e: unknown) {
    reportError('Не удалось открыть диалог сохранения файла', e)
    return null
  }
}
