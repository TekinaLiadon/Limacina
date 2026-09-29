import { isPermissionGranted, requestPermission, sendNotification, type Options } from '@tauri-apps/plugin-notification'

export type NotificationOptions = Options

export async function isNotificationPermissionGranted(): Promise<boolean> {
  return isPermissionGranted()
}

export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  return requestPermission()
}

export async function sendOsNotification(options: NotificationOptions): Promise<void> {
  await sendNotification(options)
}
