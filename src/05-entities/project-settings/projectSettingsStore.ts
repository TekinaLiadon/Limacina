import { defineStore } from 'pinia'
import type { ModLoaderKind, ProjectConfig } from '../core/types'
import { captureDirtyBaseline, hasDirtyFields, isFieldDirtyAgainst, type DirtyBaseline } from '@/06-shared'

export type ProjectDirtyField =
  | 'loaderVersion'
  | 'javaPath'
  | 'jvmArgs'
  | 'memoryRange'
  | 'autoJoinServer'

type ProjectDirtySnapshot = Pick<ProjectSettingsForm, ProjectDirtyField>
type ProjectDirtyBaseline = DirtyBaseline<ProjectDirtySnapshot>

export interface ProjectSettingsForm {
  projectName: string
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string
  javaPath: string
  javaVersion: number | null
  jvmArgs: string
  memoryRange: [number, number]
  online: boolean
  initialized: boolean
  serverUrl: string | null
  autoJoinServer: boolean
}

export interface ProjectSettingsState {
  config: ProjectSettingsForm
  isLoaded: boolean
  isSaving: boolean
  loadError: string
  loadedProject: string
  loadingProject: string
  baseline: ProjectDirtyBaseline | null
}

function defaultForm(): ProjectSettingsForm {
  return {
    projectName: '',
    mcVersion: '',
    modLoader: 'vanilla',
    loaderVersion: '',
    javaPath: '',
    javaVersion: null,
    jvmArgs: '',
    memoryRange: [512, 4096],
    online: true,
    initialized: false,
    serverUrl: null,
    autoJoinServer: false,
  }
}

const DEFAULT_MIN_MEMORY = 512
const DEFAULT_MAX_MEMORY = 4096

const parseMemory = (val: string | null | undefined, fallback: number): number => {
  if (!val) return fallback
  const num = parseInt(val.replace(/[^0-9]/g, ''), 10)
  if (Number.isNaN(num)) return fallback
  const mb = val.toUpperCase().includes('G') ? num * 1024 : num
  return Number.isFinite(mb) ? mb : fallback
}

export function projectSettingsFormFromConfig(config: ProjectConfig): ProjectSettingsForm {
  return {
    projectName: config.projectName,
    mcVersion: config.mcVersion,
    modLoader: config.modLoader,
    loaderVersion: config.loaderVersion ?? '',
    javaPath: config.javaPath ?? '',
    javaVersion: config.javaVersion ?? null,
    jvmArgs: (config.jvmArgs ?? []).join(', '),
    memoryRange: [
      parseMemory(config.minMemory, DEFAULT_MIN_MEMORY),
      parseMemory(config.maxMemory, DEFAULT_MAX_MEMORY),
    ],
    online: config.online,
    initialized: config.initialized,
    serverUrl: config.serverUrl,
    autoJoinServer: config.autoJoinServer,
  }
}

function pickDirtyFields(config: ProjectSettingsForm): ProjectDirtySnapshot {
  return {
    loaderVersion: config.loaderVersion,
    javaPath: config.javaPath,
    jvmArgs: config.jvmArgs,
    memoryRange: config.memoryRange,
    autoJoinServer: config.autoJoinServer,
  }
}

export const useProjectSettingsStore = defineStore('projectSettings', {
  state: (): ProjectSettingsState => ({
    config: defaultForm(),
    isLoaded: false,
    isSaving: false,
    loadError: '',
    loadedProject: '',
    loadingProject: '',
    baseline: null,
  }),

  getters: {
    isDirty(state): boolean {
      if (!state.isLoaded || state.baseline === null) return false
      return hasDirtyFields(state.baseline, pickDirtyFields(state.config))
    },
  },

  actions: {
    captureBaseline(): void {
      this.baseline = captureDirtyBaseline(pickDirtyFields(this.config))
    },

    isFieldDirty(key: ProjectDirtyField): boolean {
      if (this.baseline === null) return false
      return isFieldDirtyAgainst(this.baseline, pickDirtyFields(this.config), key)
    },

    startLoading(project: string): void {
      this.loadingProject = project
      this.config = defaultForm()
      this.loadError = ''
      this.isLoaded = false
      this.baseline = null
    },

    applyLoaded(project: string, config: ProjectSettingsForm): void {
      if (this.loadingProject !== project) return
      this.adoptLoaded(project, config)
    },

    adoptLoaded(project: string, config: ProjectSettingsForm): void {
      this.config = config
      this.loadedProject = project
      this.isLoaded = true
      this.loadError = ''
      this.loadingProject = ''
      this.captureBaseline()
    },

    applyError(project: string, message: string): void {
      if (this.loadingProject !== project) return
      this.config = defaultForm()
      this.loadedProject = ''
      this.isLoaded = false
      this.loadError = message
      this.loadingProject = ''
      this.baseline = null
    },

    finishLoading(project: string): void {
      if (this.loadingProject !== project) return
      this.loadingProject = ''
    },

    startSaving(): void {
      this.isSaving = true
    },

    finishSaving(): void {
      this.isSaving = false
    },
  },
})
