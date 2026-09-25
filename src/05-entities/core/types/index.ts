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

export interface AuthUserData extends LoginForm {
  projectName: string
}

export interface UpdateInfo {
  version: string
}

export type UpdateVersionInfo = UpdateInfo

export interface ServerStatus {
  online: number
  max: number
  version: string
}

export type TabKey = 'accounts' | 'add-profile' | 'mods' | 'settings' | 'debug'

export type AuthSubTab = 'login' | 'register'

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
  offlineBuild: boolean
  envProjectName: string
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
  serverStatus: ServerStatus | null
  gameUsername: string | null
  isServerReachable: boolean | null
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
