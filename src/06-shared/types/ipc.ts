export interface SavedLogin {
  username: string
}

export interface AuthProjectConfig {
  logins: SavedLogin[]
}

export interface LauncherConfig {
  launcherPath: string
  discordActivity: boolean
  keepOldConfigs: boolean
  downloadSpeedLimit: number | null
  autoUpdate: boolean
  systemNotifications: boolean
  debugMode: boolean
  startWithSystem: boolean
  closeAfterLaunch: boolean
  minimizeToTray: boolean
  theme: string
  animationsEnabled: boolean
  projectNames: string[]
  currentProject: string | null
  projects: Record<string, AuthProjectConfig>
  installId: string | null
}

export interface AppInitData {
  launcherName: string
  defaultParentPath: string
  launcherConfig: LauncherConfig | null
  version: string
  totalMemoryMb: number
  offlineBuild: boolean
  envProjectName: string | null
}

export interface UpdateInfo {
  version: string
}

export interface ServerStatus {
  online: number
  max: number
  version: string
}

export type StepEvent =
  | { type: 'started'; id: string; label: string }
  | { type: 'progress'; id: string; current: number; total: number }
  | { type: 'detail'; id: string; text: string }
  | { type: 'finished'; id: string; skipped: boolean }
  | { type: 'failed'; id: string; message: string }

export interface UserContentItem {
  id: number | null
  url: string
  model?: string | null
  active?: boolean
}

export type SkinModelMode = 'classic' | 'slim'

export interface SessionInfo {
  uuid: string
  username: string
}

export interface ConsoleLog {
  line: string
  isError: boolean
}

export interface ProjectConfig {
  projectName: string
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string | null
  javaPath: string | null
  javaVersion: number | null
  jvmArgs: string[]
  minMemory: string
  maxMemory: string
  online: boolean
  initialized: boolean
  serverUrl: string | null
  autoJoinServer: boolean
}

export type ModLoaderKind = 'vanilla' | 'fabric' | 'forge' | 'neoforge'

export interface JavaDistribution {
  name: string
  apiParameter: string
}

export interface GameExitInfo {
  success: boolean
  code: number | null
  reason: string | null
}

export interface IntegrityReport {
  total: number
  broken: number
  repaired: number
  missing: number
  failed: string[]
}

export type GameCloudsMode = 'true' | 'fast' | 'false'

export type GameChatVisibility = 'full' | 'system' | 'hidden'

export interface GameOptions {
  fov: number
  gamma: number
  renderDistance: number
  simulationDistance: number
  maxFps: number
  enableVsync: boolean
  graphicsMode: number
  mipmapLevels: number
  particles: number
  entityShadows: boolean
  ao: boolean
  renderClouds: GameCloudsMode
  fullscreen: boolean
  guiScale: number
  soundMaster: number
  soundMusic: number
  soundRecord: number
  soundWeather: number
  soundBlock: number
  soundHostile: number
  soundNeutral: number
  soundPlayer: number
  soundAmbient: number
  soundVoice: number
  chatScale: number
  chatWidth: number
  chatOpacity: number
  chatLineSpacing: number
  chatDelay: number
  textBackgroundOpacity: number
  chatVisibility: GameChatVisibility
  chatColors: boolean
  chatLinks: boolean
  chatLinksPrompt: boolean
  resourcePacks: string[]
}

export interface GameOptionsData {
  options: GameOptions
  fileExists: boolean
  availableResourcePacks: string[]
  hasGlobal: boolean
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
  minimizeToTray: boolean
}

export interface SavePlayerModelPayload {
  name: string
  url: string | null
  modelId: number | null
  slim: boolean
  data: number[] | null
}
