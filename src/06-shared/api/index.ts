import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AppInitData, AuthUserData, UpdateInfo, UpdateVersions, LauncherConfig, ProjectConfig, ModLoaderKind, ConsoleLog, StepEvent, UserContentItem, SessionInfo, JavaDistribution, GameExitInfo, IntegrityReport } from '@/05-entities/core/types'
import type { SkinModelMode } from '@/03-widgets/types'

export async function getAppInitData(): Promise<AppInitData> {
  return invoke<AppInitData>('get_app_init_data')
}

export async function checkUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>('check_update')
}

export async function getLauncherVersions(): Promise<UpdateVersions> {
  return invoke<UpdateVersions>('get_launcher_versions')
}

export async function applyUpdateCmd(version: string | null = null): Promise<void> {
  return invoke('apply_update_cmd', { version })
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

export async function clearMinecraftConfig(): Promise<string> {
  return invoke<string>('clear_minecraft_config')
}

export async function exitLauncher(): Promise<void> {
  return invoke('exit_launcher')
}

export async function saveTheme(theme: string): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('save_theme', { theme })
}

export async function saveAnimationsEnabled(animationsEnabled: boolean): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('save_animations_enabled', { animationsEnabled })
}

export async function initializeLauncher(parentPath: string): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('initialize_launcher', { parentPath })
}

export async function initializeProject(projectName: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('initialize_project', { projectName })
}

export async function setInitialized(): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('set_initialized')
}

export async function createServerProfile(serverUrl: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('create_server_profile', { serverUrl })
}

export async function createOfflineProfile(
  name: string,
  mcVersion: string,
  modLoader: ModLoaderKind,
  loaderVersion: string | null
): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('create_offline_profile', {
    name,
    mcVersion,
    modLoader,
    loaderVersion,
  })
}

export async function saveCurrentProject(projectName: string): Promise<void> {
  return invoke('save_current_project', { projectName })
}

export async function getMinecraftVersions(includeSnapshots: boolean): Promise<string[]> {
  return invoke<string[]>('get_minecraft_versions', { includeSnapshots })
}

export async function getLoaderVersions(
  modLoader: ModLoaderKind,
  mcVersion: string
): Promise<string[]> {
  return invoke<string[]>('get_loader_versions', { modLoader, mcVersion })
}

export async function authLogins(projectName: string): Promise<string[]> {
  return invoke<string[]>('auth_logins', { projectName })
}

export async function deleteAccount(projectName: string, username: string): Promise<void> {
  return invoke('delete_account', { projectName, username })
}

export async function authLogin(info: AuthUserData): Promise<void> {
  const {projectName, username, password, rememberMe} = info
  return invoke('auth_login', { projectName, username, password, rememberMe })
}

export async function authRefresh(projectName: string, username: string): Promise<void> {
  return invoke<void>('auth_refresh', { projectName, username })
}

export async function refreshManifests(): Promise<string> {
  return invoke<string>('refresh_manifests')
}

export async function authRegister(
  projectName: string,
  username: string,
  password: string
): Promise<void> {
  return invoke('auth_register', { projectName, username, password })
}

export async function changePassword(
  projectName: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  return invoke('change_password', { projectName, oldPassword, newPassword })
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

export async function sendConsoleLog(line: string, isError: boolean): Promise<void> {
  return invoke('send_frontend_log', { line, isError })
}

export async function listenGameConsole(
  callback: (log: ConsoleLog) => void
): Promise<UnlistenFn> {
  return listen<ConsoleLog>('game-console', (event) => {
    callback(event.payload)
  })
}

export async function listenLaunchSteps(
  callback: (event: StepEvent) => void
): Promise<UnlistenFn> {
  return listen<StepEvent>('launch-steps', (event) => {
    callback(event.payload)
  })
}

export async function checkFilesIntegrity(): Promise<IntegrityReport> {
  return invoke<IntegrityReport>('check_files_integrity')
}

export async function listenIntegritySteps(
  callback: (event: StepEvent) => void
): Promise<UnlistenFn> {
  return listen<StepEvent>('integrity-steps', (event) => {
    callback(event.payload)
  })
}

export async function listenGameExit(
  callback: (info: GameExitInfo) => void
): Promise<UnlistenFn> {
  return listen<GameExitInfo>('game-exit', (event) => {
    callback(event.payload)
  })
}

export async function getSessionInfo(): Promise<SessionInfo | null> {
  return invoke<SessionInfo | null>('get_session_info')
}

export async function logoutAccount(): Promise<void> {
  return invoke('logout_account')
}

export async function uploadSkin(fileData: Uint8Array, model: SkinModelMode): Promise<UserContentItem> {
  return invoke<UserContentItem>('upload_skin', fileData, {
    headers: { 'Skin-Model': model },
  })
}

export async function listSkins(uuid: string): Promise<UserContentItem[]> {
  return invoke<UserContentItem[]>('list_skins', { uuid })
}

export async function deleteSkin(id: number): Promise<void> {
  return invoke('delete_skin', { id })
}

export async function setActiveSkin(id: number): Promise<void> {
  return invoke('set_active_skin', { id })
}

export async function getProfileSkin(url: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>('get_profile_skin', { url })
  return new Uint8Array(buffer)
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

export async function getJavaDistributions(): Promise<JavaDistribution[]> {
  return invoke<JavaDistribution[]>('get_java_distributions')
}

export async function downloadAlternativeJava(
  distribution: string,
  javaVersion: string | null,
  replaceDefault: boolean
): Promise<void> {
  return invoke('download_alternative_java', { distribution, javaVersion, replaceDefault })
}
