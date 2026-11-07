import type { Ref } from 'vue'

export type {
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
  OptionalModEntry,
  ModLoaderKind,
  JavaDistribution,
  JavaProbe,
  GameExitInfo,
  IntegrityReport,
  GameOptions,
  GameOptionsData,
  LauncherSettingsPayload,
  SavePlayerModelPayload,
} from './ipc'

export type {
  ModrinthSearchResult,
  ModrinthProjectDetails,
  ModrinthInstalledMod,
  ModrinthUpdateCheck,
  ModrinthInstallResult,
  ModrinthExportMod,
  ModrinthExportReport,
  ModrinthImportPreview,
  ModrinthImportReport,
} from './modrinth'

export interface InputOptions {
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  label?: string
  list?: string[]
  readonly?: boolean
  disabled?: boolean
  size?: 'default' | 'compact'
  align?: 'start' | 'center'
}

export interface DropdownOption {
  title: string
  value: string
  img?: string
}

export type IconType = 'home' | 'referrals' | 'settings' | 'puzzle' | 'chevron-down' | 'arrow-right' | 'console'

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
