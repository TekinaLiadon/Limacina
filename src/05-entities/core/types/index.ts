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
  projectNames: string[]
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

export type TabKey = 'accounts' | 'add-server' | 'settings' | 'debug'

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
  is_error: boolean
}

export interface StepProgressItem {
  id: number
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
  error?: string
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
}

export interface ProjectConfig {
  projectName: string
  mcVersion: string
  modLoader: string
  loaderVersion: string | null
  javaPath: string | null
  jvmArgs: string[]
  minMemory: string
  maxMemory: string
  online: boolean
  initialized: boolean
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
