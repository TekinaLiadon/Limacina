import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore } from '../coreStore'
import type { LauncherConfig, ProjectConfig } from '../types'

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

type CoreStore = ReturnType<typeof useCoreStore>

const expectInvariant = (store: CoreStore): void => {
  const config = store.launcherConfig
  if (config === null) {
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
    return
  }
  expect(store.projects).toEqual(config.projectNames)
  if (store.projects.length === 0) {
    expect(store.currentProject).toBe('')
    return
  }
  expect(store.projects).toContain(store.currentProject)
}

describe('useCoreStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with the loading state', () => {
    const store = useCoreStore()
    expect(store.isLoading).toBe(true)
    expect(store.hasLauncherConfig).toBe(false)
    expect(store.launcherConfig).toBeNull()
    expect(store.projectConfig).toBeNull()
    expect(store.offlineBuild).toBe(false)
  })

  it('setLauncherConfig stores the config and marks it present', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    expect(store.hasLauncherConfig).toBe(true)
    expect(store.launcherConfig?.theme).toBe('default-dark')
    expectInvariant(store)
  })

  it('setLauncherConfig prefers the saved project and mirrors the list', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha', 'Beta'], 'Beta'))
    expect(store.projects).toEqual(['Alpha', 'Beta'])
    expect(store.currentProject).toBe('Beta')
  })

  it('setLauncherConfig falls back to the first project when the saved one is missing', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha', 'Beta'], 'Removed'))
    expect(store.currentProject).toBe('Alpha')
  })

  it('setLauncherConfig falls back to the first project when nothing is saved', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], null))
    expect(store.currentProject).toBe('Alpha')
  })

  it('setLauncherConfig keeps the current project empty without projects', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig([], null))
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
  })

  it('setLauncherConfig clears the stale current project when the list becomes empty', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    store.setLauncherConfig(makeConfig([], null))
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
  })

  it('setLauncherConfig(null) drops the config and resets the projection', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    store.setLauncherConfig(null)
    expect(store.hasLauncherConfig).toBe(false)
    expect(store.launcherConfig).toBeNull()
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
    expectInvariant(store)
  })

  it('copies the project list instead of sharing the config array', () => {
    const store = useCoreStore()
    const config = makeConfig(['Alpha'], null)
    store.setLauncherConfig(config)
    config.projectNames.push('Injected')
    expect(store.projects).toEqual(['Alpha'])
  })

  it('applySavedLauncherConfig keeps the live project scope and takes the saved fields', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha', 'Beta'], 'Beta'))

    store.applySavedLauncherConfig({ ...makeConfig(['Alpha'], 'Alpha'), theme: 'lime-dark' })

    expect(store.launcherConfig?.theme).toBe('lime-dark')
    expect(store.launcherConfig?.projectNames).toEqual(['Alpha', 'Beta'])
    expect(store.launcherConfig?.currentProject).toBe('Beta')
    expect(store.projects).toEqual(['Alpha', 'Beta'])
    expect(store.currentProject).toBe('Beta')
    expectInvariant(store)
  })

  it('applySavedLauncherConfig keeps a freshly added project that the response predates', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    store.addProject('Beta', makeProjectConfig({ projectName: 'Beta' }))

    store.applySavedLauncherConfig(makeConfig(['Alpha'], 'Alpha'))

    expect(store.projects).toEqual(['Alpha', 'Beta'])
    expect(store.currentProject).toBe('Beta')
    expectInvariant(store)
  })

  it('applySavedLauncherConfig establishes the scope when no config exists yet', () => {
    const store = useCoreStore()

    store.applySavedLauncherConfig(makeConfig(['Alpha'], 'Alpha'))

    expect(store.launcherConfig?.projectNames).toEqual(['Alpha'])
    expect(store.projects).toEqual(['Alpha'])
    expect(store.currentProject).toBe('Alpha')
    expectInvariant(store)
  })

  it('applySavedLauncherConfig does not resurrect projects after the list became empty', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    store.setLauncherConfig(makeConfig([], null))

    store.applySavedLauncherConfig(makeConfig(['Alpha'], 'Alpha'))

    expect(store.launcherConfig?.projectNames).toEqual([])
    expect(store.launcherConfig?.currentProject).toBeNull()
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBe('')
    expectInvariant(store)
  })

  it('applyProjectSwitch updates the current project, its config and the launcher config', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha', 'Beta'], 'Alpha'))
    const beta = makeProjectConfig({ projectName: 'Beta' })
    store.applyProjectSwitch('Beta', beta)
    expect(store.currentProject).toBe('Beta')
    expect(store.projectConfig).toStrictEqual(beta)
    expect(store.launcherConfig?.currentProject).toBe('Beta')
    expectInvariant(store)
  })

  it('applyProjectSwitch works without a launcher config', () => {
    const store = useCoreStore()
    const beta = makeProjectConfig({ projectName: 'Beta' })
    store.applyProjectSwitch('Beta', beta)
    expect(store.launcherConfig).toBeNull()
    expect(store.currentProject).toBe('Beta')
    expect(store.projectConfig).toStrictEqual(beta)
  })

  it('addProject appends the project, mirrors it into the launcher config and switches to it', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    const beta = makeProjectConfig({ projectName: 'Beta' })
    store.addProject('Beta', beta)
    expect(store.projects).toEqual(['Alpha', 'Beta'])
    expect(store.currentProject).toBe('Beta')
    expect(store.projectConfig).toStrictEqual(beta)
    expect(store.launcherConfig?.projectNames).toEqual(['Alpha', 'Beta'])
    expect(store.launcherConfig?.currentProject).toBe('Beta')
    expectInvariant(store)
  })

  it('addProject does not duplicate an existing project', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    store.addProject('Alpha', makeProjectConfig({ projectName: 'Alpha' }))
    expect(store.projects).toEqual(['Alpha'])
    expect(store.launcherConfig?.projectNames).toEqual(['Alpha'])
    expectInvariant(store)
  })

  it('addProject works without a launcher config', () => {
    const store = useCoreStore()
    const alpha = makeProjectConfig({ projectName: 'Alpha' })
    store.addProject('Alpha', alpha)
    expect(store.launcherConfig).toBeNull()
    expect(store.projects).toEqual(['Alpha'])
    expect(store.currentProject).toBe('Alpha')
    expect(store.projectConfig).toStrictEqual(alpha)
  })

  it('setProjectConfig replaces the project config', () => {
    const store = useCoreStore()
    store.setProjectConfig(makeProjectConfig({ online: true }))
    expect(store.isOnlineProject).toBe(true)
    store.setProjectConfig(null)
    expect(store.projectConfig).toBeNull()
    expect(store.isOnlineProject).toBe(false)
  })

  it('setPendingCpmProjectPath sets and clears the pending path', () => {
    const store = useCoreStore()
    expect(store.pendingCpmProjectPath).toBeNull()
    store.setPendingCpmProjectPath('/models/custom.cpmproject')
    expect(store.pendingCpmProjectPath).toBe('/models/custom.cpmproject')
    store.setPendingCpmProjectPath(null)
    expect(store.pendingCpmProjectPath).toBeNull()
  })

  it('isOfflineProject and isOnlineProject reflect only the project config', () => {
    const store = useCoreStore()
    expect(store.isOfflineProject).toBe(false)
    expect(store.isOnlineProject).toBe(false)

    store.setProjectConfig(makeProjectConfig({ online: true }))
    expect(store.isOnlineProject).toBe(true)
    expect(store.isOfflineProject).toBe(false)

    store.setProjectConfig(makeProjectConfig({ online: false }))
    expect(store.isOnlineProject).toBe(false)
    expect(store.isOfflineProject).toBe(true)

    store.setProjectConfig(null)
    expect(store.isOnlineProject).toBe(false)
    expect(store.isOfflineProject).toBe(false)
  })

  it('isServerBuild mirrors the offline build flag regardless of the project config', () => {
    const store = useCoreStore()
    expect(store.isServerBuild).toBe(true)

    store.offlineBuild = true
    expect(store.isServerBuild).toBe(false)

    store.setProjectConfig(makeProjectConfig({ online: true }))
    expect(store.isServerBuild).toBe(false)

    store.offlineBuild = false
    expect(store.isServerBuild).toBe(true)
  })

  it('needsOfflineSetup is true only for an offline build without projects', () => {
    const store = useCoreStore()
    expect(store.needsOfflineSetup).toBe(false)

    store.offlineBuild = true
    expect(store.needsOfflineSetup).toBe(true)

    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    expect(store.needsOfflineSetup).toBe(false)
  })

  it('keeps the projection in sync across mixed store updates', () => {
    const store = useCoreStore()
    store.setLauncherConfig(makeConfig(['Alpha', 'Beta'], 'Beta'))
    expectInvariant(store)

    store.applyProjectSwitch('Alpha', makeProjectConfig({ projectName: 'Alpha' }))
    expectInvariant(store)

    store.addProject('Gamma', makeProjectConfig({ projectName: 'Gamma' }))
    expectInvariant(store)

    store.setLauncherConfig(makeConfig(['Alpha'], 'Alpha'))
    expectInvariant(store)

    store.setLauncherConfig(null)
    expectInvariant(store)
  })
})
