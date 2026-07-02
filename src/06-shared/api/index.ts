import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AppInitData, AuthUserData, UpdateInfo, LauncherConfig, ProjectConfig, AuthSaved, ConsoleLog } from '@/05-entities/core/types'

export async function getAppInitData(): Promise<AppInitData> {
  return invoke<AppInitData>('get_app_init_data')
}

export async function checkUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>('check_update')
}

export async function applyUpdateCmd(): Promise<void> {
  return invoke('apply_update_cmd')
}

export async function loadSettingsProject(projectName: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('load_settings_project', { projectName })
}

export async function saveSettingsProject(config: ProjectConfig): Promise<void> {
  return invoke('save_settings_project', { config })
}

export async function saveLauncherConfig(parentPath: string): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('save_launcher_config', { parentPath })
}

export async function authLogins(projectName: string): Promise<string[]> {
  return invoke<string[]>('auth_logins', { projectName })
}

export async function authSaved(projectName: string): Promise<AuthSaved | null> {
  return invoke<AuthSaved | null>('auth_saved', { projectName })
}

export async function authLogin(info: AuthUserData): Promise<void> {
  const {projectName, username, password, rememberMe} = info
  return invoke('auth_login', { projectName, username, password, rememberMe })
}

export async function downloadJava(): Promise<void> {
  return invoke('download_java')
}

export async function downloadServerFile(): Promise<void> {
  return invoke('download_server_file')
}

export async function downloadMinecraft(): Promise<void> {
  return invoke('download_minecraft')
}

export async function downloadServerMods(): Promise<void> {
  return invoke('download_server_mods')
}

export async function startMinecraft(): Promise<void> {
  return invoke('start_minecraft')
}

export async function getStartupLogs(): Promise<ConsoleLog[]> {
  return invoke<ConsoleLog[]>('get_startup_logs')
}

export async function listenGameConsole(
  callback: (log: ConsoleLog) => void
): Promise<UnlistenFn> {
  return listen<ConsoleLog>('game-console', (event) => {
    callback(event.payload)
  })
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
