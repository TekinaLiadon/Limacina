import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Color } from '@tauri-apps/api/webview'
import { reportError } from '../utils/reportError'
import type { AppInitData, AuthUserData, UpdateInfo, UpdateVersionInfo, LauncherConfig, ProjectConfig, ModLoaderKind, ConsoleLog, StepEvent, UserContentItem, SessionInfo, JavaDistribution, GameExitInfo, IntegrityReport, ServerStatus, GameOptions, GameOptionsData, SkinModelMode, LauncherSettingsPayload, SavePlayerModelPayload, ModrinthSearchResult, ModrinthProjectDetails, ModrinthInstalledMod, ModrinthUpdateCheck, ModrinthInstallResult } from '@/05-entities'

export interface CommandErrorPayload {
  code: string
  message: string
}

const INTERNAL_ERROR_CODE = 'internal'

export function getCommandError(e: unknown): CommandErrorPayload {
  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    const payload = e as { code: unknown; message: unknown }
    if (typeof payload.code === 'string' && typeof payload.message === 'string') {
      return { code: payload.code, message: payload.message }
    }
  }
  if (typeof e === 'string') return { code: INTERNAL_ERROR_CODE, message: e }
  if (e instanceof Error) return { code: INTERNAL_ERROR_CODE, message: e.message }
  return { code: INTERNAL_ERROR_CODE, message: String(e) }
}

export function getErrorMessage(e: unknown): string {
  return getCommandError(e).message
}

export async function getAppInitData(): Promise<AppInitData> {
  return invoke<AppInitData>('get_app_init_data')
}

interface UpdateInfoRaw {
  version: string
}

const toUpdateInfo = (raw: UpdateInfoRaw): UpdateInfo => ({
  version: raw.version,
})

export async function checkUpdate(): Promise<UpdateInfo | null> {
  const raw = await invoke<UpdateInfoRaw | null>('check_update')
  return raw ? toUpdateInfo(raw) : null
}

export async function getLauncherVersions(): Promise<UpdateVersionInfo[]> {
  const raw = await invoke<UpdateInfoRaw[]>('get_launcher_versions')
  return raw.map(toUpdateInfo)
}

export async function applyUpdateCmd(version: string | null = null): Promise<void> {
  return invoke('apply_update_cmd', { version })
}

export async function getServerStatus(): Promise<ServerStatus> {
  return invoke<ServerStatus>('get_server_status')
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

export async function saveLauncherSettings(settings: LauncherSettingsPayload): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('save_launcher_settings', { settings })
}

export async function clearMinecraftConfig(): Promise<string> {
  return invoke<string>('clear_minecraft_config')
}

export async function getGameOptions(projectName: string): Promise<GameOptionsData> {
  return invoke<GameOptionsData>('get_game_options', { projectName })
}

export async function saveGameOptions(projectName: string, options: GameOptions): Promise<void> {
  return invoke('save_game_options', { projectName, options })
}

export async function saveGlobalGameOptions(options: GameOptions): Promise<void> {
  return invoke('save_global_game_options', { options })
}

export async function importGlobalGameOptions(): Promise<GameOptions | null> {
  return invoke<GameOptions | null>('import_global_game_options')
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

function hexToWindowColor(hex: string): Color | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  const value = match ? Number.parseInt(match[1] ?? '', 16) : Number.NaN
  if (Number.isNaN(value)) return null
  return {
    red: (value >> 16) & 0xff,
    green: (value >> 8) & 0xff,
    blue: value & 0xff,
    alpha: 255,
  }
}

export async function setWindowBackgroundColor(hex: string): Promise<void> {
  const color = hexToWindowColor(hex)
  if (!color) {
    reportError('Не удалось применить цвет окна', new Error(`Некорректный цвет: ${hex}`))
    return
  }
  await getCurrentWebviewWindow().setBackgroundColor(color)
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

export async function loadInstallJournal(
  project: string,
  fingerprint: string,
  plan: string[]
): Promise<string[]> {
  return invoke<string[]>('load_install_journal', { project, fingerprint, plan })
}

export async function recordInstallStep(
  project: string,
  fingerprint: string,
  key: string
): Promise<void> {
  return invoke('record_install_step', { project, fingerprint, key })
}

export async function clearInstallJournal(project: string): Promise<void> {
  return invoke('clear_install_journal', { project })
}

export async function createServerProfile(serverUrl: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>('create_server_profile', { serverUrl })
}

export async function getServerConnectUrl(): Promise<string> {
  return invoke<string>('get_server_connect_url')
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

export async function deleteProject(): Promise<LauncherConfig> {
  return invoke<LauncherConfig>('delete_project')
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

export async function getNotificationIcon(): Promise<string | null> {
  return invoke<string | null>('get_notification_icon')
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

export async function getGameState(): Promise<string | null> {
  return invoke<string | null>('get_game_state')
}

export async function getLaunchState(): Promise<boolean> {
  return invoke<boolean>('get_launch_state')
}

export async function listenGameStarted(
  callback: (username: string) => void
): Promise<UnlistenFn> {
  return listen<string>('game-started', (event) => {
    callback(event.payload)
  })
}

export async function hideMainWindow(): Promise<void> {
  await getCurrentWebviewWindow().hide()
}

export async function pingLauncherServer(): Promise<boolean> {
  return invoke<boolean>('ping_launcher_server')
}

export async function clearSession(): Promise<void> {
  return invoke('clear_session')
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

export async function readSkinFile(path: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>('read_skin_file', { path })
  return new Uint8Array(buffer)
}

export async function saveOfflineSkin(fileData: Uint8Array, model: SkinModelMode): Promise<void> {
  return invoke('save_offline_skin', fileData, {
    headers: { 'Skin-Model': model },
  })
}

export async function getOfflineSkin(): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>('get_offline_skin')
  return new Uint8Array(buffer)
}

export async function getOfflineSkinModel(): Promise<SkinModelMode | null> {
  return invoke<SkinModelMode | null>('get_offline_skin_model')
}

export async function deleteOfflineSkin(): Promise<void> {
  return invoke('delete_offline_skin')
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

export async function savePlayerModel(payload: SavePlayerModelPayload): Promise<void> {
  return invoke('save_player_model', { ...payload })
}

export async function getPlayerModelsLimit(): Promise<number | null> {
  return invoke<number | null>('get_player_models_limit')
}

export async function setPlayerModelsLimit(limit: number | null): Promise<void> {
  return invoke('set_player_models_limit', { limit })
}

export async function readCpmProjectFile(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_cpm_project_file', { path })
}

export async function takeCpmProjectPath(): Promise<string | null> {
  return invoke<string | null>('take_cpm_project_path')
}

export async function listenCpmProjectOpen(
  callback: (path: string) => void
): Promise<UnlistenFn> {
  return listen<string>('cpm-project-open', (event) => {
    callback(event.payload)
  })
}

export async function getJavaDistributions(): Promise<JavaDistribution[]> {
  return invoke<JavaDistribution[]>('get_java_distributions')
}

export async function getJavaVersion(mcVersion: string): Promise<string> {
  return invoke('get_java_version', { mcVersion })
}

export async function downloadAlternativeJava(
  distribution: string,
  javaVersion: string | null,
  replaceDefault: boolean
): Promise<void> {
  return invoke('download_alternative_java', { distribution, javaVersion, replaceDefault })
}

export async function modrinthSearch(payload: {
  query: string
  index: string
  categories: string[]
  offset: number
}): Promise<ModrinthSearchResult> {
  return invoke('modrinth_search', { ...payload })
}

export async function modrinthProject(id: string): Promise<ModrinthProjectDetails> {
  return invoke('modrinth_project', { id })
}

export async function modrinthInstalled(): Promise<ModrinthInstalledMod[]> {
  return invoke('modrinth_installed')
}

export async function modrinthCheckUpdates(): Promise<ModrinthUpdateCheck[]> {
  return invoke('modrinth_check_updates')
}

export async function modrinthInstall(projectId: string): Promise<ModrinthInstallResult> {
  return invoke('modrinth_install', { projectId })
}

export async function modrinthUninstall(projectId: string): Promise<void> {
  return invoke('modrinth_uninstall', { projectId })
}
