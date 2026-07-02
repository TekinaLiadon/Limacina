import { defineStore } from 'pinia'
import type { CoreState } from './types'

export const useCoreStore = defineStore('core', {
  state: (): CoreState => ({
    isLoading: true,
    hasLauncherConfig: null,
    launcherName: '',
    defaultParentPath: '',
    launcherConfig: null,
    version: '',
    activeTab: 'login',
    currentProject: 'Cordelia',
    projects: ['Cordelia'],
    totalMemoryMb: 0,
    debugLogs: [],
    isLoggedIn: false,
    loginSteps: [],
    loginProgress: 0,
    loginError: '',
  }),
})
