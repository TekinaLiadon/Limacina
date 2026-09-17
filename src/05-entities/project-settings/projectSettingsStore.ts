import { defineStore } from 'pinia'
import type { ModLoaderKind } from '../core/types'

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

export const useProjectSettingsStore = defineStore('projectSettings', {
  state: (): ProjectSettingsState => ({
    config: defaultForm(),
    isLoaded: false,
    isSaving: false,
    loadError: '',
    loadedProject: '',
    loadingProject: '',
  }),

  actions: {
    startLoading(project: string): void {
      this.loadingProject = project
      this.loadError = ''
      this.isLoaded = false
    },

    applyLoaded(project: string, config: ProjectSettingsForm): void {
      if (this.loadingProject !== project) return
      this.config = config
      this.loadedProject = project
      this.isLoaded = true
      this.loadError = ''
      this.loadingProject = ''
    },

    applyError(project: string, message: string): void {
      if (this.loadingProject !== project) return
      this.loadedProject = ''
      this.isLoaded = false
      this.loadError = message
      this.loadingProject = ''
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
