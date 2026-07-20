import { defineStore } from 'pinia'
import type { CoreState } from './types/index'

export const useCoreStore = defineStore('core', {
  state: (): CoreState => ({
    isLoading: true,
    hasLauncherConfig: null,
    launcherName: '',
    defaultParentPath: '',
    launcherConfig: null,
    version: '',
    activeTab: 'accounts',
    currentProject: '',
    projects: [],
    totalMemoryMb: 0,
    isLoggedIn: false,
    session: null,
    loginSteps: [],
    loginProgress: 0,
    loginError: '',
  }),
})
