import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

export async function isAutostartEnabled(): Promise<boolean> {
  return isEnabled()
}

export async function enableAutostart(): Promise<void> {
  await enable()
}

export async function disableAutostart(): Promise<void> {
  await disable()
}
