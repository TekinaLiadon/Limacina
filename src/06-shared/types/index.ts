import type { Ref } from 'vue'

export type {
  SavedLogin,
  AuthProjectConfig,
  LauncherConfig,
  AppInitData,
  UpdateInfo,
  ServerStatus,
  StepEvent,
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
} from './ipc'

export type {
  ModrinthProjectType,
  ModrinthSide,
  ModrinthVersionType,
  ModrinthSearchHit,
  ModrinthSearchResult,
  ModrinthLicense,
  ModrinthProject,
  ModrinthVersionFile,
  ModrinthDependency,
  ModrinthVersion,
  ModrinthProjectDetails,
  ModrinthInstalledMod,
  ModrinthUpdateCheck,
  ModrinthInstallResult,
} from './modrinth'

export interface InputOptions {
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  label?: string
  list?: string[]
  readonly?: boolean
  disabled?: boolean
}

export interface DropdownOption {
  title: string
  value: string
  img?: string
}

export type IconType = 'home' | 'referrals' | 'settings' | 'puzzle' | 'chevron-down' | 'arrow-right'

export interface ViewerControls {
  minZoom: number
  zoomLevel: Ref<number>
  rotationY: Ref<number>
  rotationX: Ref<number>
  autoRotate: Ref<boolean>
  fitDistance: Ref<number>
  zoomIn: () => void
  zoomOut: () => void
  rotateLeft: () => void
  rotateRight: () => void
  rotateUp: () => void
  rotateDown: () => void
  resetZoom: () => void
  resetView: () => void
}
