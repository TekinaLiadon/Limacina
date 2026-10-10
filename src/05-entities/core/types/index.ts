import type { ModLoaderKind } from '@/06-shared'

export type {
  SavedLogin,
  AuthProjectConfig,
  LauncherConfig,
  AppInitData,
  UpdateInfo,
  ServerStatus,
  StepEvent,
  StepStatus,
  StepProgressItem,
  UserContentItem,
  SkinModelMode,
  SessionInfo,
  ConsoleLog,
  ProjectConfig,
  ModLoaderKind,
  JavaDistribution,
  GameExitInfo,
  IntegrityReport,
  GameCloudsMode,
  GameChatVisibility,
  GameOptions,
  GameOptionsData,
  LauncherSettingsPayload,
  SavePlayerModelPayload,
} from '@/06-shared'

export type TabKey = 'accounts' | 'add-profile' | 'mods' | 'settings' | 'debug'

export type AuthSubTab = 'login' | 'register'

export interface AuthUserData extends LoginForm {
  projectName: string
}

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
