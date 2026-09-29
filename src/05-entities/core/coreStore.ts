import { defineStore } from 'pinia'
import type { CoreState, LauncherConfig, SessionInfo } from './types/index'

export const useCoreStore = defineStore('core', {
  state: (): CoreState => ({
    isLoading: true,
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
    projectConfig: null,
    serverStatus: null,
    gameUsername: null,
    isServerReachable: null,
    pendingCpmProjectPath: null,
  }),

  getters: {
    needsOfflineSetup: (state): boolean => state.offlineBuild && state.projects.length === 0,
    hasLauncherConfig: (state): boolean => state.launcherConfig !== null,
    isOfflineProject: (state): boolean => state.projectConfig?.online === false,
    isOnlineProject: (state): boolean => !state.offlineBuild && state.projectConfig?.online === true,
  },

  actions: {
    applyLauncherConfig(config: LauncherConfig): void {
      this.launcherConfig = config
      this.applyLauncherProjects(config)
    },

    applyLauncherProjects(config: LauncherConfig): void {
      this.projects = [...config.projectNames]
      const [first] = this.projects
      if (first === undefined) {
        this.currentProject = ''
        return
      }

      const saved = config.currentProject
      this.currentProject = saved !== null && this.projects.includes(saved) ? saved : first
    },

    applySession(session: SessionInfo): void {
      this.session = session
      this.isLoggedIn = true
    },

    clearSessionState(): void {
      this.isLoggedIn = false
      this.session = null
    },
  },
})
