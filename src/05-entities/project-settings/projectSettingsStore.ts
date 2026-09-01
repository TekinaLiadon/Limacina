import { defineStore } from 'pinia'
import type { ModLoaderKind } from '../core/types'

export interface ProjectSettingsForm {
  projectName: string
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string
  javaPath: string
  jvmArgs: string
  memoryRange: [number, number]
  online: boolean
  initialized: boolean
  serverUrl: string | null
}

export interface ProjectSettingsState {
  config: ProjectSettingsForm
  isLoaded: boolean
  isSaving: boolean
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
    jvmArgs: '',
    memoryRange: [512, 4096],
    online: true,
    initialized: false,
    serverUrl: null,
  }
}

export const useProjectSettingsStore = defineStore('projectSettings', {
  state: (): ProjectSettingsState => ({
    config: defaultForm(),
    isLoaded: false,
    isSaving: false,
    loadedProject: '',
    loadingProject: '',
  }),

  actions: {
    startLoading(project: string): void {
      this.loadingProject = project
      this.isLoaded = false
    },

    applyLoaded(project: string, config: ProjectSettingsForm): void {
      this.config = config
      this.loadedProject = project
      this.isLoaded = true
    },

    finishLoading(): void {
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
