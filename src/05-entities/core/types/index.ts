export interface LauncherConfig {
  parentPath: string
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

export type TabKey = 'login' | 'add-server' | 'register' | 'settings' | 'debug'

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
  debugLogs: ConsoleLog[]
  isLoggedIn: boolean
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
}

export interface LoginForm {
  username: string
  password: string
  rememberMe: boolean
}

export type AuthSaved = Pick<LoginForm, 'username' | 'password'>
