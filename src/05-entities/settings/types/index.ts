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

export type ThemeMode = 'dark' | 'light'

export interface ThemePreview {
  bg: string
  surface: string
  accent: string
}

export interface ThemeFamily {
  id: string
  title: string
  description: string
  preview: Record<ThemeMode, ThemePreview>
}
