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
  theme: string
  animationsEnabled: boolean
  projectNames: string[]
  currentProject: string | null
  projects: Record<string, AuthProjectConfig>
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
  platforms: UpdatePlatform[]
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

export type StepStatus = 'pending' | 'active' | 'done' | 'error'

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
}export interface CoreState {
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
  autoJoinServer: boolean
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
  storeID?: number
  rscale?: CPMVec3
  mcScale?: number
  mirror?: boolean
  texture?: boolean
  hidden?: boolean
  show?: boolean
  glow?: boolean
  singleTex?: boolean
  extrude?: boolean
  recolor?: boolean
  color?: string
  u?: number
  v?: number
  textureSize?: number
  faceUV?: Record<string, CPMFaceUV>
  children?: CPMChild[]
}

export interface CPMElement {
  id: string
  name: string
  pos: CPMVec3
  rotation: CPMVec3
  scale?: CPMVec3
  show?: boolean
  hidden?: boolean
  customPart?: boolean
  dup?: boolean
  storeID?: number
  disableVanillaAnim?: boolean
  children?: CPMChild[]
}

export interface CPMConfig {
  skinSize: { x: number; y: number }
  scaling?: number
  skinType?: 'default' | 'slim'
  hideHeadIfSkull?: boolean
  removeArmorOffset?: boolean
  removeBedOffset?: boolean
  enableInvisGlow?: boolean
  elements: CPMElement[]
}

export type CPMAnimationKind = 'gesture' | 'custom-pose' | 'vanilla-pose' | 'layer' | 'value-layer' | 'setup' | 'finish'

export interface CPMAnimationFrameComponent {
  storeID: number
  pos: CPMVec3
  rotation: CPMVec3
  scale: CPMVec3
  show: boolean
}

export interface CPMAnimationFrame {
  components: CPMAnimationFrameComponent[]
}

export type CPMAnimationInterpolator = 'linear_loop' | 'linear_single' | 'poly_loop' | 'poly_single' | 'trig_loop' | 'trig_single' | 'no'

export interface CPMAnimation {
  id: string
  name: string
  kind: CPMAnimationKind
  duration: number
  priority: number
  loop: boolean
  additive: boolean
  interpolator: CPMAnimationInterpolator
  hidden: boolean
  frames: CPMAnimationFrame[]
}

export interface CPMData {
  config: CPMConfig
  textureUrl: string
  animations?: CPMAnimation[]
}

export interface JavaDistribution {
  name: string
  apiParameter: string
}

export interface GameExitInfo {
  success: boolean
  code: number | null
}

export interface IntegrityReport {
  total: number
  broken: number
  repaired: number
  missing: number
  failed: string[]
}
