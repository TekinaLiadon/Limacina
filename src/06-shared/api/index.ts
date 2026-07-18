import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AppInitData, AuthUserData, UpdateInfo, LauncherConfig, ProjectConfig, AuthSaved, ConsoleLog, UserContentItem, SessionInfo } from '@/05-entities/core/types'

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

export interface LauncherSettingsPayload {
  discordActivity: boolean
  keepOldConfigs: boolean
  downloadSpeedLimit: number | null
  autoUpdate: boolean
  systemNotifications: boolean
  debugMode: boolean
  startWithSystem: boolean
  closeAfterLaunch: boolean
}

export async function saveLauncherSettings(settings: LauncherSettingsPayload): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('save_launcher_settings', { settings })
}

export async function initializeLauncher(parentPath: string): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('initialize_launcher', { parentPath })
}

export async function initializeProject(projectName: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('initialize_project', { projectName })
}

export async function setInitialized(): Promise<void> {
  return invoke('set_initialized')
}

export async function authLogins(projectName: string): Promise<string[]> {
  return invoke<string[]>('auth_logins', { projectName })
}

export async function deleteAccount(projectName: string, username: string): Promise<void> {
  return invoke('delete_account', { projectName, username })
}

export async function authSaved(projectName: string): Promise<AuthSaved | null> {
  return invoke<AuthSaved | null>('auth_saved', { projectName })
}

export async function authLogin(info: AuthUserData): Promise<void> {
  const {projectName, username, password, rememberMe} = info
  return invoke('auth_login', { projectName, username, password, rememberMe })
}

export async function authRefresh(projectName: string): Promise<string> {
  return invoke<string>('auth_refresh', { projectName })
}

export async function authRegister(
  projectName: string,
  username: string,
  password: string
): Promise<void> {
  return invoke('auth_register', { projectName, username, password })
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

export async function selectAccount(projectName: string, username: string): Promise<SessionInfo> {
  return invoke<SessionInfo>('select_account', { projectName, username })
}

export async function getSessionInfo(): Promise<SessionInfo | null> {
  return invoke<SessionInfo | null>('get_session_info')
}

export async function logoutAccount(): Promise<void> {
  return invoke('logout_account')
}

export async function uploadSkin(fileData: number[]): Promise<UserContentItem> {
  return invoke<UserContentItem>('upload_skin', { fileData })
}

export async function listSkins(uuid: string): Promise<UserContentItem[]> {
  return invoke<UserContentItem[]>('list_skins', { uuid })
}

export async function deleteSkin(id: number): Promise<void> {
  return invoke('delete_skin', { id })
}

export async function uploadModel(fileContent: string): Promise<UserContentItem> {
  return invoke<UserContentItem>('upload_model', { fileContent })
}

export async function listModels(uuid: string): Promise<UserContentItem[]> {
  return invoke<UserContentItem[]>('list_models', { uuid })
}

export async function deleteModel(id: number): Promise<void> {
  return invoke('delete_model', { id })
}
