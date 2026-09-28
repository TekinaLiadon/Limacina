import { defineStore } from 'pinia'
import type { CoreState, LauncherConfig } from './types/index'

export const useCoreStore = defineStore('core', {
  state: (): CoreState => ({
    isLoading: true,
    hasLauncherConfig: null,
    launcherName: '',
    defaultParentPath: '',
    launcherConfig: null,
    version: '',
    offlineBuild: false,
    envProjectName: '',
    currentProject: '',
    projects: [],
    totalMemoryMb: 0,
    isLoggedIn: false,
    session: null,
    loginError: '',
    projectConfig: null,
    serverStatus: null,
    gameUsername: null,
    isServerReachable: null,
    pendingCpmProjectPath: null,
  }),

  getters: {
    needsOfflineSetup: (state): boolean => state.offlineBuild && state.projects.length === 0,
  },

  actions: {
    applyLauncherConfig(config: LauncherConfig): void {
      this.launcherConfig = config
      this.applyLauncherProjects(config)
      this.hasLauncherConfig = true
    },

    applyLauncherProjects(config: LauncherConfig): void {
      this.projects = [...config.projectNames]
      const [first] = this.projects
      if (first === undefined) return

      const saved = config.currentProject
      this.currentProject = saved !== null && this.projects.includes(saved) ? saved : first
    },
  },
})
