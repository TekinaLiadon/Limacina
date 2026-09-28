import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore } from './coreStore'
import type { LauncherConfig } from './types'

const makeConfig = (projectNames: string[], currentProject: string | null): LauncherConfig => ({
  launcherPath: '/launcher',
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

describe('useCoreStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with the loading state and no session', () => {
    const store = useCoreStore()
    expect(store.isLoading).toBe(true)
    expect(store.hasLauncherConfig).toBeNull()
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

  it('copies the project list instead of sharing the config array', () => {
    const store = useCoreStore()
    const config = makeConfig(['Alpha'], null)
    store.applyLauncherProjects(config)
    config.projectNames.push('Injected')
    expect(store.projects).toEqual(['Alpha'])
  })
})
