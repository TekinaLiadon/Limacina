import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, useNotificationStore, useOptionalModsStore, type LauncherConfig, type OptionalModEntry, type ProjectConfig, type StepEvent } from '@/05-entities'
import { reportError, OPTIONAL_SYNC_STEP_IDS, STEP_IDS } from '@/06-shared'

const api = vi.hoisted(() => ({
  fetchOptionalMods: vi.fn(),
  listenLaunchSteps: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  fetchOptionalMods: api.fetchOptionalMods,
  listenLaunchSteps: api.listenLaunchSteps,
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError: vi.fn(),
}))

const makeEntry = (path: string): OptionalModEntry => ({
  path,
  hash: `sha1-${path}`,
})

const makeLauncherConfig = (overrides: Partial<LauncherConfig> = {}): LauncherConfig => ({
  launcherPath: '/games/limacina',
  installId: null,
  discordActivity: false,
  keepOldConfigs: true,
  downloadSpeedLimit: null,
  autoUpdate: false,
  systemNotifications: true,
  debugMode: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: true,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames: ['proj'],
  currentProject: 'proj',
  projects: {},
  ...overrides,
})

const makeProjectConfig = (modLoader: 'fabric' | 'vanilla', online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader,
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  cpuCores: null,
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
  optionalMods: [],
})

const applyProject = (modLoader: 'fabric' | 'vanilla', online: boolean, offlineBuild = false): void => {
  const core = useCoreStore()
  core.launcherConfig = makeLauncherConfig()
  core.offlineBuild = offlineBuild
  core.projectConfig = makeProjectConfig(modLoader, online)
}

interface OptionalModsApi {
  loadList: () => Promise<void>
  startSyncWarnings: () => Promise<void>
}

const loadOptionalMods = async (): Promise<OptionalModsApi> => {
  const { useOptionalMods } = await import('../useOptionalMods')
  return useOptionalMods()
}

describe('useOptionalMods loadList', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.fetchOptionalMods.mockReset()
    api.listenLaunchSteps.mockReset()
    vi.mocked(reportError).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fills the store from the fetched list on a server build with an online loader profile', async () => {
    applyProject('fabric', true)
    api.fetchOptionalMods.mockResolvedValue([makeEntry('optional-mods/b.jar'), makeEntry('optional-mods/a.jar')])

    const optionalMods = await loadOptionalMods()
    await optionalMods.loadList()

    expect(api.fetchOptionalMods).toHaveBeenCalledTimes(1)
    expect(useOptionalModsStore().list).toEqual([
      { path: 'optional-mods/b.jar', hash: 'sha1-optional-mods/b.jar' },
      { path: 'optional-mods/a.jar', hash: 'sha1-optional-mods/a.jar' },
    ])
    expect(reportError).not.toHaveBeenCalled()
  })

  it('skips the request and drops the list for an offline build', async () => {
    applyProject('fabric', true, true)
    useOptionalModsStore().setList([makeEntry('optional-mods/stale.jar')])

    const optionalMods = await loadOptionalMods()
    await optionalMods.loadList()

    expect(api.fetchOptionalMods).not.toHaveBeenCalled()
    expect(useOptionalModsStore().list).toBeNull()
  })

  it('skips the request and drops the list for an offline project profile', async () => {
    applyProject('fabric', false)
    useOptionalModsStore().setList([makeEntry('optional-mods/stale.jar')])

    const optionalMods = await loadOptionalMods()
    await optionalMods.loadList()

    expect(api.fetchOptionalMods).not.toHaveBeenCalled()
    expect(useOptionalModsStore().list).toBeNull()
  })

  it('skips the request and drops the list for a vanilla profile', async () => {
    applyProject('vanilla', true)
    useOptionalModsStore().setList([makeEntry('optional-mods/stale.jar')])

    const optionalMods = await loadOptionalMods()
    await optionalMods.loadList()

    expect(api.fetchOptionalMods).not.toHaveBeenCalled()
    expect(useOptionalModsStore().list).toBeNull()
  })

  it('swallows a failed list request with a report and keeps the store empty', async () => {
    applyProject('fabric', true)
    api.fetchOptionalMods.mockRejectedValue(new Error('server 500'))

    const optionalMods = await loadOptionalMods()
    await optionalMods.loadList()

    expect(api.fetchOptionalMods).toHaveBeenCalledTimes(1)
    expect(useOptionalModsStore().list).toBeNull()
    expect(reportError).toHaveBeenCalledWith('Не удалось получить список необязательных модов', expect.anything())
  })
})

describe('useOptionalMods startSyncWarnings', () => {
  let emitStep: ((event: StepEvent) => void) | undefined

  const startWarnings = async (): Promise<void> => {
    const optionalMods = await loadOptionalMods()
    await optionalMods.startSyncWarnings()
  }

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    emitStep = undefined
    api.fetchOptionalMods.mockReset()
    api.listenLaunchSteps.mockReset()
    api.listenLaunchSteps.mockImplementation(async (handler: (event: StepEvent) => void) => {
      emitStep = handler
      return (): void => {}
    })
    vi.mocked(reportError).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the optional sync toast when an optional list step fails', async () => {
    await startWarnings()
    const notification = useNotificationStore()

    emitStep?.({ type: 'failed', id: STEP_IDS.modsOptionalList, message: 'server 500' })

    expect(notification.visible).toBe(true)
    expect(notification.message).toBe('Не удалось синхронизировать необязательные моды')
  })

  it('shows the optional sync toast when an optional download step fails', async () => {
    await startWarnings()
    const notification = useNotificationStore()

    emitStep?.({ type: 'failed', id: STEP_IDS.modsOptionalDownload, message: 'download 500' })

    expect(notification.visible).toBe(true)
    expect(notification.message).toBe('Не удалось синхронизировать необязательные моды')
  })

  it('does not toast a failed mandatory mods step', async () => {
    await startWarnings()
    const notification = useNotificationStore()

    emitStep?.({ type: 'failed', id: STEP_IDS.modsClean, message: 'cleanup failed' })

    expect(notification.visible).toBe(false)
  })

  it('does not toast finished optional steps', async () => {
    await startWarnings()
    const notification = useNotificationStore()

    emitStep?.({ type: 'finished', id: STEP_IDS.modsOptionalDownload, skipped: false })

    expect(notification.visible).toBe(false)
  })

  it('registers the launch steps listener once per application', async () => {
    await startWarnings()
    await startWarnings()

    expect(api.listenLaunchSteps).toHaveBeenCalledTimes(1)
  })

  it('keeps only the optional sync step ids in the warning set', () => {
    expect([...OPTIONAL_SYNC_STEP_IDS].sort()).toEqual(
      [STEP_IDS.modsOptionalDownload, STEP_IDS.modsOptionalList].sort(),
    )
  })
})
