import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdateCmd,
  availableCpuCores,
  authLogin,
  authLogins,
  authRefresh,
  authRegister,
  changePassword,
  checkFilesIntegrity,
  checkUpdate,
  clearInstallJournal,
  clearMinecraftConfig,
  clearSession,
  createOfflineProfile,
  createServerProfile,
  deleteAccount,
  deleteModel,
  deleteOfflineSkin,
  deleteProject,
  deleteSkin,
  downloadAlternativeJava,
  downloadJava,
  downloadMinecraft,
  downloadServerFile,
  downloadServerMods,
  exitLauncher,
  getAppInitData,
  getCommandError,
  getErrorMessage,
  getGameOptions,
  getGameState,
  getJavaDistributions,
  getJavaVersion,
  getLaunchState,
  getLauncherVersions,
  getLoaderVersions,
  getMinecraftVersions,
  getNotificationIcon,
  getOfflineSkin,
  getOfflineSkinModel,
  getProfileSkin,
  getServerConnectUrl,
  getServerStatus,
  getSessionInfo,
  getStartupLogs,
  importGlobalGameOptions,
  initializeLauncher,
  initializeProject,
  killGameProcess,
  listModels,
  listSkins,
  listenCpmProjectOpen,
  listenGameConsole,
  listenGameExit,
  listenGameStarted,
  listenIntegritySteps,
  listenLaunchSteps,
  loadInstallJournal,
  loadSettingsProject,
  modrinthCheckUpdates,
  modrinthExportPrepare,
  modrinthExportSave,
  modrinthImportApply,
  modrinthImportPreview,
  modrinthInstall,
  modrinthInstalled,
  modrinthProject,
  modrinthSearch,
  modrinthUninstall,
  openModsFolder,
  pingLauncherServer,
  probeJava,
  readCpmProjectFile,
  readSkinFile,
  recordInstallStep,
  refreshManifests,
  saveAnimationsEnabled,
  saveCurrentProject,
  saveGameOptions,
  saveGlobalGameOptions,
  saveLauncherConfig,
  saveLauncherSettings,
  saveOfflineSkin,
  savePlayerModel,
  saveSettingsProject,
  saveTheme,
  setActiveSkin,
  setInitialized,
  setWindowBackgroundColor,
  isWindowMinimized,
  startMinecraft,
  takeCpmProjectPath,
  uploadModel,
  uploadSkin,
} from '../index'
import type { GameOptions, LauncherSettingsPayload } from '../../types'
import { makeProjectConfig } from '@/test-support/fixtures'

const eventApi = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: eventApi.listen }))

const windowApi = vi.hoisted(() => ({ isMinimized: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: (): unknown => ({ isMinimized: windowApi.isMinimized }),
}))

const webviewApi = vi.hoisted(() => ({ setBackgroundColor: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: (): unknown => ({ setBackgroundColor: webviewApi.setBackgroundColor }),
}))

describe('getCommandError', () => {
  it('passes through command error payloads', () => {
    expect(getCommandError({ code: 'auth_failed', message: 'Неверный пароль' })).toEqual({
      code: 'auth_failed',
      message: 'Неверный пароль',
    })
  })

  it('ignores payloads with non-string fields', () => {
    expect(getCommandError({ code: 42, message: 'x' })).toEqual({
      code: 'internal',
      message: '[object Object]',
    })
  })

  it('wraps plain strings as internal errors', () => {
    expect(getCommandError('Сбой')).toEqual({ code: 'internal', message: 'Сбой' })
  })

  it('wraps Error instances as internal errors', () => {
    expect(getCommandError(new Error('timeout'))).toEqual({ code: 'internal', message: 'timeout' })
  })

  it('stringifies unknown values', () => {
    expect(getCommandError(404)).toEqual({ code: 'internal', message: '404' })
    expect(getCommandError(null)).toEqual({ code: 'internal', message: 'null' })
    expect(getCommandError(undefined)).toEqual({ code: 'internal', message: 'undefined' })
  })

  it('ignores payloads missing the message field', () => {
    expect(getCommandError({ code: 'x' })).toEqual({ code: 'internal', message: '[object Object]' })
  })
})

describe('getErrorMessage', () => {
  it('returns the message of a command error', () => {
    expect(getErrorMessage({ code: 'x', message: 'msg' })).toBe('msg')
  })

  it('returns the text of a plain string error', () => {
    expect(getErrorMessage('Сбой')).toBe('Сбой')
  })

  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('timeout'))).toBe('timeout')
  })
})

interface TauriInternals {
  invoke: ReturnType<typeof vi.fn>
}

const setInternals = (): TauriInternals => {
  const internals: TauriInternals = { invoke: vi.fn() }
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals
  return internals
}

describe('savePlayerModel', () => {
  let invoke: TauriInternals['invoke']

  beforeEach(() => {
    ;({ invoke } = setInternals())
    invoke.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('sends the offline model bytes as the raw invoke body without a JSON array', async () => {
    await savePlayerModel('proj', {
      name: 'Герой 100%',
      url: null,
      modelId: null,
      slim: true,
      data: new Uint8Array([83, 1, 255]),
    })

    expect(invoke).toHaveBeenCalledOnce()
    const [command, body, options] = invoke.mock.calls[0]!
    expect(command).toBe('save_player_model')
    expect(body).toBeInstanceOf(Uint8Array)
    expect(Array.from(body as Uint8Array)).toEqual([83, 1, 255])
    expect(options).toEqual({
      headers: {
        'Project-Name': 'proj',
        'Model-Name': encodeURIComponent('Герой 100%'),
        'Model-Slim': 'true',
      },
    })
  })

  it('passes the online link and id through headers with an empty raw body', async () => {
    await savePlayerModel('proj', {
      name: 'hero',
      url: 'https://cdn/model-9.cpm',
      modelId: 9,
      slim: false,
      data: null,
    })

    const [command, body, options] = invoke.mock.calls[0]!
    expect(command).toBe('save_player_model')
    expect(body).toBeInstanceOf(Uint8Array)
    expect((body as Uint8Array).length).toBe(0)
    expect(options).toEqual({
      headers: {
        'Project-Name': 'proj',
        'Model-Name': 'hero',
        'Model-Url': encodeURIComponent('https://cdn/model-9.cpm'),
        'Model-Id': '9',
        'Model-Slim': 'false',
      },
    })
  })
})

const projectConfig = makeProjectConfig()

const gameOptions = {
  fov: 60,
  gamma: 0.5,
  renderDistance: 12,
} as GameOptions

const launcherSettings: LauncherSettingsPayload = {
  discordActivity: true,
  keepOldConfigs: false,
  downloadSpeedLimit: null,
  autoUpdate: true,
  systemNotifications: false,
  debugMode: false,
  startWithSystem: true,
  closeAfterLaunch: false,
  minimizeToTray: true,
}

interface InvokeCase {
  label: string
  call: () => Promise<unknown>
  command: string
  args: Record<string, unknown>
}

const invokeCases: InvokeCase[] = [
  { label: 'getAppInitData', call: () => getAppInitData(), command: 'get_app_init_data', args: {} },
  { label: 'checkUpdate', call: () => checkUpdate(), command: 'check_update', args: {} },
  { label: 'getLauncherVersions', call: () => getLauncherVersions(), command: 'get_launcher_versions', args: {} },
  { label: 'applyUpdateCmd with a version', call: () => applyUpdateCmd('1.2.3'), command: 'apply_update_cmd', args: { version: '1.2.3' } },
  { label: 'getServerStatus', call: () => getServerStatus(), command: 'get_server_status', args: {} },
  { label: 'loadSettingsProject', call: () => loadSettingsProject('proj'), command: 'load_settings_project', args: { projectName: 'proj' } },
  { label: 'saveSettingsProject', call: () => saveSettingsProject(projectConfig), command: 'save_settings_project', args: { config: projectConfig } },
  { label: 'probeJava', call: () => probeJava('/jvm/bin/java'), command: 'probe_java_version', args: { path: '/jvm/bin/java' } },
  { label: 'availableCpuCores', call: () => availableCpuCores(), command: 'available_cpu_cores', args: {} },
  { label: 'saveLauncherConfig', call: () => saveLauncherConfig('/games'), command: 'save_launcher_config', args: { parentPath: '/games' } },
  { label: 'saveLauncherSettings', call: () => saveLauncherSettings(launcherSettings), command: 'save_launcher_settings', args: { settings: launcherSettings } },
  { label: 'clearMinecraftConfig', call: () => clearMinecraftConfig('proj'), command: 'clear_minecraft_config', args: { projectName: 'proj' } },
  { label: 'getGameOptions', call: () => getGameOptions('proj'), command: 'get_game_options', args: { projectName: 'proj' } },
  { label: 'saveGameOptions', call: () => saveGameOptions('proj', gameOptions), command: 'save_game_options', args: { projectName: 'proj', options: gameOptions } },
  { label: 'saveGlobalGameOptions', call: () => saveGlobalGameOptions(gameOptions), command: 'save_global_game_options', args: { options: gameOptions } },
  { label: 'importGlobalGameOptions', call: () => importGlobalGameOptions(), command: 'import_global_game_options', args: {} },
  { label: 'exitLauncher', call: () => exitLauncher(), command: 'exit_launcher', args: {} },
  { label: 'saveTheme', call: () => saveTheme('night-light'), command: 'save_theme', args: { theme: 'night-light' } },
  { label: 'saveAnimationsEnabled', call: () => saveAnimationsEnabled(false), command: 'save_animations_enabled', args: { animationsEnabled: false } },
  { label: 'initializeLauncher', call: () => initializeLauncher('/games'), command: 'initialize_launcher', args: { parentPath: '/games' } },
  { label: 'initializeProject', call: () => initializeProject('proj'), command: 'initialize_project', args: { projectName: 'proj' } },
  { label: 'setInitialized', call: () => setInitialized(), command: 'set_initialized', args: {} },
  { label: 'loadInstallJournal', call: () => loadInstallJournal('proj', 'fp', ['a', 'b']), command: 'load_install_journal', args: { project: 'proj', fingerprint: 'fp', plan: ['a', 'b'] } },
  { label: 'recordInstallStep', call: () => recordInstallStep('proj', 'fp', 'key'), command: 'record_install_step', args: { project: 'proj', fingerprint: 'fp', key: 'key' } },
  { label: 'clearInstallJournal', call: () => clearInstallJournal('proj'), command: 'clear_install_journal', args: { project: 'proj' } },
  { label: 'createServerProfile', call: () => createServerProfile('https://server'), command: 'create_server_profile', args: { serverUrl: 'https://server' } },
  { label: 'getServerConnectUrl', call: () => getServerConnectUrl(), command: 'get_server_connect_url', args: {} },
  { label: 'createOfflineProfile', call: () => createOfflineProfile('proj', '1.20.1', 'fabric', '1.0.0'), command: 'create_offline_profile', args: { name: 'proj', mcVersion: '1.20.1', modLoader: 'fabric', loaderVersion: '1.0.0' } },
  { label: 'createOfflineProfile without loader version', call: () => createOfflineProfile('proj', '1.20.1', 'vanilla', null), command: 'create_offline_profile', args: { name: 'proj', mcVersion: '1.20.1', modLoader: 'vanilla', loaderVersion: null } },
  { label: 'saveCurrentProject', call: () => saveCurrentProject('proj'), command: 'save_current_project', args: { projectName: 'proj' } },
  { label: 'deleteProject', call: () => deleteProject('proj'), command: 'delete_project', args: { projectName: 'proj' } },
  { label: 'getMinecraftVersions', call: () => getMinecraftVersions(true), command: 'get_minecraft_versions', args: { includeSnapshots: true } },
  { label: 'getLoaderVersions', call: () => getLoaderVersions('forge', '1.20.1'), command: 'get_loader_versions', args: { modLoader: 'forge', mcVersion: '1.20.1' } },
  { label: 'authLogins', call: () => authLogins('proj'), command: 'auth_logins', args: { projectName: 'proj' } },
  { label: 'deleteAccount', call: () => deleteAccount('proj', 'steve'), command: 'delete_account', args: { projectName: 'proj', username: 'steve' } },
  { label: 'authLogin', call: () => authLogin('proj', 'steve', 'pass', true), command: 'auth_login', args: { projectName: 'proj', username: 'steve', password: 'pass', rememberMe: true } },
  { label: 'authRefresh', call: () => authRefresh('proj', 'steve'), command: 'auth_refresh', args: { projectName: 'proj', username: 'steve' } },
  { label: 'refreshManifests', call: () => refreshManifests(), command: 'refresh_manifests', args: {} },
  { label: 'authRegister', call: () => authRegister('proj', 'steve', 'pass'), command: 'auth_register', args: { projectName: 'proj', username: 'steve', password: 'pass' } },
  { label: 'changePassword', call: () => changePassword('proj', 'old', 'new'), command: 'change_password', args: { projectName: 'proj', oldPassword: 'old', newPassword: 'new' } },
  { label: 'downloadJava', call: () => downloadJava(), command: 'download_java', args: {} },
  { label: 'downloadServerFile', call: () => downloadServerFile(), command: 'download_server_file', args: {} },
  { label: 'downloadMinecraft with options', call: () => downloadMinecraft(gameOptions), command: 'download_minecraft', args: { options: gameOptions } },
  { label: 'downloadServerMods', call: () => downloadServerMods(), command: 'download_server_mods', args: {} },
  { label: 'startMinecraft', call: () => startMinecraft(), command: 'start_minecraft', args: {} },
  { label: 'getStartupLogs', call: () => getStartupLogs(), command: 'get_startup_logs', args: {} },
  { label: 'getNotificationIcon', call: () => getNotificationIcon(), command: 'get_notification_icon', args: {} },
  { label: 'checkFilesIntegrity', call: () => checkFilesIntegrity(), command: 'check_files_integrity', args: {} },
  { label: 'getSessionInfo', call: () => getSessionInfo(), command: 'get_session_info', args: {} },
  { label: 'getGameState', call: () => getGameState(), command: 'get_game_state', args: {} },
  { label: 'getLaunchState', call: () => getLaunchState(), command: 'get_launch_state', args: {} },
  { label: 'killGameProcess', call: () => killGameProcess(), command: 'kill_game_process', args: {} },
  { label: 'pingLauncherServer', call: () => pingLauncherServer(), command: 'ping_launcher_server', args: {} },
  { label: 'clearSession', call: () => clearSession(), command: 'clear_session', args: {} },
  { label: 'listSkins', call: () => listSkins('uuid-1'), command: 'list_skins', args: { uuid: 'uuid-1' } },
  { label: 'deleteSkin', call: () => deleteSkin(7), command: 'delete_skin', args: { id: 7 } },
  { label: 'setActiveSkin', call: () => setActiveSkin(7), command: 'set_active_skin', args: { id: 7 } },
  { label: 'uploadModel', call: () => uploadModel('model json'), command: 'upload_model', args: { fileContent: 'model json' } },
  { label: 'listModels', call: () => listModels('uuid-1'), command: 'list_models', args: { uuid: 'uuid-1' } },
  { label: 'deleteModel', call: () => deleteModel(3), command: 'delete_model', args: { id: 3 } },
  { label: 'takeCpmProjectPath', call: () => takeCpmProjectPath(), command: 'take_cpm_project_path', args: {} },
  { label: 'getJavaDistributions', call: () => getJavaDistributions(), command: 'get_java_distributions', args: {} },
  { label: 'getJavaVersion', call: () => getJavaVersion('1.20.1'), command: 'get_java_version', args: { mcVersion: '1.20.1' } },
  { label: 'downloadAlternativeJava', call: () => downloadAlternativeJava('temurin', '17', true), command: 'download_alternative_java', args: { distribution: 'temurin', javaVersion: '17', replaceDefault: true } },
  { label: 'modrinthSearch', call: () => modrinthSearch({ query: 'sodium', index: 'relevance', categories: ['performance'], offset: 20 }), command: 'modrinth_search', args: { query: 'sodium', index: 'relevance', categories: ['performance'], offset: 20 } },
  { label: 'modrinthProject', call: () => modrinthProject('sodium'), command: 'modrinth_project', args: { id: 'sodium' } },
  { label: 'modrinthInstalled', call: () => modrinthInstalled(), command: 'modrinth_installed', args: {} },
  { label: 'modrinthCheckUpdates', call: () => modrinthCheckUpdates(), command: 'modrinth_check_updates', args: {} },
  { label: 'modrinthInstall with a version', call: () => modrinthInstall('sodium', 'v1'), command: 'modrinth_install', args: { projectId: 'sodium', versionId: 'v1' } },
  { label: 'modrinthInstall without a version', call: () => modrinthInstall('sodium'), command: 'modrinth_install', args: { projectId: 'sodium', versionId: undefined } },
  { label: 'modrinthUninstall', call: () => modrinthUninstall('sodium'), command: 'modrinth_uninstall', args: { projectId: 'sodium' } },
  { label: 'modrinthExportPrepare', call: () => modrinthExportPrepare(), command: 'modrinth_export_prepare', args: {} },
  { label: 'modrinthExportSave', call: () => modrinthExportSave('/mods.mrpack', []), command: 'modrinth_export_save', args: { path: '/mods.mrpack', mods: [] } },
  { label: 'modrinthImportPreview', call: () => modrinthImportPreview('zip'), command: 'modrinth_import_preview', args: { content: 'zip' } },
  { label: 'modrinthImportApply', call: () => modrinthImportApply('zip'), command: 'modrinth_import_apply', args: { content: 'zip' } },
  { label: 'openModsFolder', call: () => openModsFolder(), command: 'open_mods_folder', args: {} },
  { label: 'getOfflineSkinModel', call: () => getOfflineSkinModel('proj'), command: 'get_offline_skin_model', args: { projectName: 'proj' } },
  { label: 'deleteOfflineSkin', call: () => deleteOfflineSkin('proj'), command: 'delete_offline_skin', args: { projectName: 'proj' } },
]

describe('invoke wrappers', () => {
  let invoke: TauriInternals['invoke']

  beforeEach(() => {
    ;({ invoke } = setInternals())
    invoke.mockResolvedValue(null)
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it.each(invokeCases)('$label calls $command', async ({ call, command, args }) => {
    await call()

    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(command, args, undefined)
  })

  it('applyUpdateCmd defaults to the null version', async () => {
    await applyUpdateCmd()

    expect(invoke).toHaveBeenCalledWith('apply_update_cmd', { version: null }, undefined)
  })

  it('downloadMinecraft defaults to the null options', async () => {
    await downloadMinecraft()

    expect(invoke).toHaveBeenCalledWith('download_minecraft', { options: null }, undefined)
  })
})

describe('raw-body wrappers', () => {
  let invoke: TauriInternals['invoke']

  beforeEach(() => {
    ;({ invoke } = setInternals())
    invoke.mockResolvedValue(new ArrayBuffer(2))
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('upload_skin sends the bytes as the raw body with the Skin-Model header', async () => {
    await uploadSkin(new Uint8Array([137, 80, 78, 71]), 'classic')

    expect(invoke).toHaveBeenCalledOnce()
    const [command, body, options] = invoke.mock.calls[0]!
    expect(command).toBe('upload_skin')
    expect(Array.from(body as Uint8Array)).toEqual([137, 80, 78, 71])
    expect(options).toEqual({ headers: { 'Skin-Model': 'classic' } })
  })

  it('upload_skin passes the slim model header', async () => {
    await uploadSkin(new Uint8Array([1]), 'slim')

    const [, , options] = invoke.mock.calls[0]!
    expect(options).toEqual({ headers: { 'Skin-Model': 'slim' } })
  })

  it.each([
    { label: 'getProfileSkin', call: () => getProfileSkin('https://cdn/skin.png'), command: 'get_profile_skin', args: { url: 'https://cdn/skin.png' } },
    { label: 'readSkinFile', call: () => readSkinFile('/skins/a.png'), command: 'read_skin_file', args: { path: '/skins/a.png' } },
    { label: 'getOfflineSkin', call: () => getOfflineSkin('proj'), command: 'get_offline_skin', args: { projectName: 'proj' } },
    { label: 'readCpmProjectFile', call: () => readCpmProjectFile('/models/a.zip'), command: 'read_cpm_project_file', args: { path: '/models/a.zip' } },
  ])('$label wraps the ArrayBuffer response into a Uint8Array', async ({ call, command, args }) => {
    invoke.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)

    await expect(call()).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(invoke).toHaveBeenCalledWith(command, args, undefined)
  })

  it('saveOfflineSkin serializes the file bytes into a JSON array', async () => {
    await saveOfflineSkin('proj', new Uint8Array([9, 0, 255]), 'slim')

    expect(invoke).toHaveBeenCalledWith(
      'save_offline_skin',
      { projectName: 'proj', model: 'slim', fileData: [9, 0, 255] },
      undefined,
    )
  })
})

describe('event wrappers', () => {
  const unlisten = (): void => {}

  beforeEach(() => {
    eventApi.listen.mockReset()
    eventApi.listen.mockResolvedValue(unlisten)
  })

  const listenCases: Array<[string, string, (callback: (payload: unknown) => void) => Promise<unknown>]> = [
    ['listenGameConsole', 'game-console', listenGameConsole],
    ['listenLaunchSteps', 'launch-steps', listenLaunchSteps],
    ['listenIntegritySteps', 'integrity-steps', listenIntegritySteps],
    ['listenGameExit', 'game-exit', listenGameExit],
    ['listenGameStarted', 'game-started', listenGameStarted],
    ['listenCpmProjectOpen', 'cpm-project-open', listenCpmProjectOpen],
  ]

  it.each(listenCases)('%s subscribes to %s and forwards the payload', async (_label, event, subscribe) => {
    const handler = vi.fn()

    const result = await subscribe(handler)

    expect(eventApi.listen).toHaveBeenCalledOnce()
    const [name, wired] = eventApi.listen.mock.calls[0]!
    expect(name).toBe(event)
    wired({ payload: 'событие' })
    expect(handler).toHaveBeenCalledWith('событие')
    expect(result).toBe(unlisten)
  })
})

describe('window wrappers', () => {
  beforeEach(() => {
    windowApi.isMinimized.mockReset().mockResolvedValue(true)
    webviewApi.setBackgroundColor.mockReset().mockResolvedValue(undefined)
  })

  it('isWindowMinimized asks the current window', async () => {
    await expect(isWindowMinimized()).resolves.toBe(true)

    expect(windowApi.isMinimized).toHaveBeenCalledOnce()
  })

  it('setWindowBackgroundColor parses a hex color into RGBA', async () => {
    await setWindowBackgroundColor('#1A2b3C')

    expect(webviewApi.setBackgroundColor).toHaveBeenCalledWith({ red: 26, green: 43, blue: 60, alpha: 255 })
  })

  it('setWindowBackgroundColor reports an invalid color without applying it', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await setWindowBackgroundColor('красный')

    expect(webviewApi.setBackgroundColor).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalled()
    logError.mockRestore()
  })
})
