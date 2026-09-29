import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore } from './coreStore'
import type { LauncherConfig, ProjectConfig } from './types'

const makeConfig = (projectNames: string[], currentProject: string | null): LauncherConfig => ({
  launcherPath: '/launcher',
  installId: null,
  discordActivity: false,
  keepOldConfigs: false,
  downloadSpeedLimit: null,
  autoUpdate: true,
  systemNotifications: false,
  debugMode: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: false,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames,
  currentProject,
  projects: {},
})

const makeProjectConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  projectName: 'Alpha',
  mcVersion: '1.21.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512M',
  maxMemory: '2048M',
  online: true,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
  ...overrides,
})

describe('useCoreStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with the loading state and no session', () => {
    const store = useCoreStore()
    expect(store.isLoading).toBe(true)
    expect(store.hasLauncherConfig).toBe(false)
    expect(store.launcherConfig).toBeNull()
    expect(store.isLoggedIn).toBe(false)
    expect(store.session).toBeNull()
    expect(store.projectConfig).toBeNull()
    expect(store.gameUsername).toBeNull()
    expect(store.isServerReachable).toBeNull()
    expect(store.offlineBuild).toBe(false)
  })

  it('applyLauncherConfig stores the config and marks it present', () => {
    const store = useCoreStore()
    store.applyLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    expect(store.hasLauncherConfig).toBe(true)
    expect(store.launcherConfig?.theme).toBe('default-dark')
  })

  it('hasLauncherConfig derives from the launcher config presence', () => {
    const store = useCoreStore()
    expect(store.hasLauncherConfig).toBe(false)
    store.launcherConfig = makeConfig(['Alpha'], 'Alpha')
    expect(store.hasLauncherConfig).toBe(true)
    store.launcherConfig = null
    expect(store.hasLauncherConfig).toBe(false)
  })

  it('applySession stores the session and marks the user logged in', () => {
    const store = useCoreStore()
    store.applySession({ uuid: 'u1', username: 'Steve' })
    expect(store.session).toEqual({ uuid: 'u1', username: 'Steve' })
    expect(store.isLoggedIn).toBe(true)
  })

  it('clearSessionState resets the session fields together', () => {
    const store = useCoreStore()
    store.applySession({ uuid: 'u1', username: 'Steve' })
    store.clearSessionState()
    expect(store.isLoggedIn).toBe(false)
    expect(store.session).toBeNull()
  })

  it('isOfflineProject and isOnlineProject reflect the project config', () => {
    const store = useCoreStore()
    expect(store.isOfflineProject).toBe(false)
    expect(store.isOnlineProject).toBe(false)

    store.offlineBuild = true
    store.projectConfig = makeProjectConfig({ online: true })
    expect(store.isOfflineProject).toBe(false)
    expect(store.isOnlineProject).toBe(false)

    store.offlineBuild = false
    expect(store.isOnlineProject).toBe(true)
    expect(store.isOfflineProject).toBe(false)

    store.projectConfig = makeProjectConfig({ online: false })
    expect(store.isOnlineProject).toBe(false)
    expect(store.isOfflineProject).toBe(true)
  })

  it('applyLauncherProjects copies the project list and prefers the saved project', () => {
    const store = useCoreStore()
    store.applyLauncherProjects(makeConfig(['Alpha', 'Beta'], 'Beta'))
    expect(store.projects).toEqual(['Alpha', 'Beta'])
    expect(store.currentProject).toBe('Beta')
  })

  it('applyLauncherProjects falls back to the first project when the saved one is missing', () => {
    const store = useCoreStore()
    store.applyLauncherProjects(makeConfig(['Alpha', 'Beta'], 'Removed'))
    expect(store.currentProject).toBe('Alpha')
  })

  it('needsOfflineSetup is true only for an offline build without projects', () => {
    const store = useCoreStore()
    expect(store.needsOfflineSetup).toBe(false)

    store.offlineBuild = true
    expect(store.needsOfflineSetup).toBe(true)

    store.projects = ['Alpha']
    expect(store.needsOfflineSetup).toBe(false)
  })

  it('applyLauncherProjects falls back to the first project when nothing is saved', () => {
    const store = useCoreStore()
    store.applyLauncherProjects(makeConfig(['Alpha'], null))
    expect(store.currentProject).toBe('Alpha')
  })

  it('applyLauncherProjects keeps the current project empty without projects', () => {
    const store = useCoreStore()
    store.applyLauncherProjects(makeConfig([], null))
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
  })

  it('applyLauncherProjects clears the stale current project when the list becomes empty', () => {
    const store = useCoreStore()
    store.applyLauncherProjects(makeConfig(['Alpha'], 'Alpha'))
    store.applyLauncherProjects(makeConfig([], null))
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
  })

  it('copies the project list instead of sharing the config array', () => {
    const store = useCoreStore()
    const config = makeConfig(['Alpha'], null)
    store.applyLauncherProjects(config)
    config.projectNames.push('Injected')
    expect(store.projects).toEqual(['Alpha'])
  })
})
