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
  theme: string
  animationsEnabled: boolean
  projectNames: string[]
  currentProject: string | null
}

export interface AppInitData {
  launcherName: string
  defaultParentPath: string
  launcherConfig: LauncherConfig | null
  version: string
  totalMemoryMb: number
}

export interface AuthUserData extends LoginForm {
  projectName: string
}

export interface UpdateInfo {
  version: string
}

export interface UpdatePlatform {
  os: string
  arch: string
}

export interface UpdateVersionInfo {
  version: string
  platforms: UpdatePlatform[]
}

export interface UpdateVersions {
  version: string
  platforms: UpdatePlatform[]
  versions: UpdateVersionInfo[]
}

export type TabKey = 'accounts' | 'add-profile' | 'settings' | 'debug'

export type AuthSubTab = 'login' | 'register'

export interface UserContentItem {
  id: number | null
  url: string
}

export interface SessionInfo {
  uuid: string
  username: string
}

export interface ConsoleLog {
  line: string
  isError: boolean
}

export type StepEvent =
  | { type: 'started'; id: string; label: string }
  | { type: 'progress'; id: string; current: number; total: number }
  | { type: 'detail'; id: string; text: string }
  | { type: 'finished'; id: string; skipped: boolean }
  | { type: 'failed'; id: string; message: string }

export type StepStatus = 'active' | 'done' | 'error'

export interface StepProgressItem {
  key: string
  label: string
  status: StepStatus
  skipped: boolean
  current: number
  total: number
  detail: string
  error: string
  shownAt: number
}

export interface CoreState {
  isLoading: boolean
  hasLauncherConfig: boolean | null
  launcherName: string
  defaultParentPath: string
  launcherConfig: LauncherConfig | null
  version: string
  activeTab: TabKey
  currentProject: string
  projects: string[]
  totalMemoryMb: number
  isLoggedIn: boolean
  session: SessionInfo | null
  loginSteps: StepProgressItem[]
  loginProgress: number
  loginError: string
  projectConfig: ProjectConfig | null
}

export interface ProjectConfig {
  projectName: string
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string | null
  javaPath: string | null
  jvmArgs: string[]
  minMemory: string
  maxMemory: string
  online: boolean
  initialized: boolean
  serverUrl: string | null
}

export type ModLoaderKind = 'vanilla' | 'fabric' | 'forge' | 'neoforge'

export type ProfileKind = 'server' | 'offline'

export interface ServerProfileForm {
  serverUrl: string
}

export interface OfflineProfileForm {
  name: string
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string
  includeSnapshots: boolean
}

export interface LoginForm {
  username: string
  password: string
  rememberMe: boolean
}

export type AuthSaved = Pick<LoginForm, 'username' | 'password'>

export interface RegisterForm {
  login: string
  password: string
  confirmPassword: string
}

export interface CPMVec3 {
  x: number
  y: number
  z: number
}

export interface CPMFaceUV {
  sx: number
  sy: number
  ex: number
  ey: number
  rot: string
  autoUV: boolean
}

export interface CPMChild {
  name: string
  size: CPMVec3
  offset: CPMVec3
  pos: CPMVec3
  rotation: CPMVec3
  scale: CPMVec3
  mcScale?: number
  mirror?: boolean
  texture?: boolean
  hidden?: boolean
  show?: boolean
  faceUV: Record<string, CPMFaceUV>
  children?: CPMChild[]
  _hidden?: boolean
  _visible: boolean
}

export interface CPMElement {
  id: string
  name: string
  pos: CPMVec3
  rotation: CPMVec3
  scale?: CPMVec3
  show?: boolean
  children?: CPMChild[]
}

export interface CPMConfig {
  skinSize: { x: number; y: number }
  scaling?: number
  skinType?: 'default' | 'slim'
  elements: CPMElement[]
}

export interface CPMData {
  config: CPMConfig
  textureUrl: string
}

export interface JavaDistribution {
  name: string
  apiParameter: string
}
