import type { TabKey } from '@/05-entities'
import type { IconType } from '@/06-shared'

export interface TabItem {
  key: TabKey
  icon: IconType
  label: string
}

export interface LauncherBehaviorForm {
  discordActivity: boolean
  autoUpdate: boolean
  keepOldConfigs: boolean
  startWithSystem: boolean
  closeAfterLaunch: boolean
  minimizeToTray: boolean
  systemNotifications: boolean
  debugMode: boolean
  downloadSpeedLimit: string
}
