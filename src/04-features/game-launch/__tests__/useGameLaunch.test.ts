import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  clearInstallJournal,
  downloadJava,
  downloadMinecraft,
  downloadServerFile,
  downloadServerMods,
  exitLauncher,
  initializeProject,
  loadInstallJournal,
  recordInstallStep,
  setInitialized,
  startMinecraft,
} from '@/06-shared/api'
import { useGameLaunch } from '../useGameLaunch'
import { useLaunchStore, useCoreStore, type ProjectConfig } from '@/05-entities'
import { createStepItem, STEP_IDS, type StepPlanItem } from '@/06-shared'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  initializeProject: vi.fn(),
  setInitialized: vi.fn(),
  clearInstallJournal: vi.fn(),
  loadInstallJournal: vi.fn(),
  recordInstallStep: vi.fn(),
  downloadJava: vi.fn(),
  downloadServerFile: vi.fn(),
  downloadServerMods: vi.fn(),
  downloadMinecraft: vi.fn(),
  startMinecraft: vi.fn(),
  exitLauncher: vi.fn(),
}))

const streamMocks = vi.hoisted(() => ({
  prefillLaunchSteps: vi.fn(),
  resetLaunchSteps: vi.fn(),
  flushLaunchSteps: vi.fn(),
}))

vi.mock('../useLaunchStepsStream', () => ({
  useLaunchStepsStream: () => streamMocks,
}))

const makeConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online: true,
  initialized: false,
  serverUrl: 'https://example.com',
  autoJoinServer: false,
  ...overrides,
})

const prefillPlanKeys = (): string[] => {
  const { calls } = streamMocks.prefillLaunchSteps.mock
  const [lastCall] = calls.slice(-1)
  const plan = lastCall?.[0]
  if (plan === undefined) throw new Error('prefill was not called')
  return plan.map((item: { key: string; label: string }) => item.key)
}

describe('useGameLaunch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    streamMocks.flushLaunchSteps.mockResolvedValue(undefined)
    streamMocks.prefillLaunchSteps.mockImplementation((plan: StepPlanItem[]) => {
      useLaunchStore().launchSteps = plan.map((item) => ({
        ...createStepItem(item.key, item.label, 0),
        status: 'pending' as const,
      }))
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useLaunchStore().isLaunching = true
  })

  it('runs the full install flow for an uninitialized online fabric project', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(
      makeConfig({ modLoader: 'fabric', initialized: false }),
    )
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue([])

    await useGameLaunch().executeSteps()

    expect(downloadJava).toHaveBeenCalledTimes(1)
    expect(downloadServerFile).toHaveBeenCalledTimes(1)
    expect(downloadServerMods).toHaveBeenCalledTimes(1)
    expect(downloadMinecraft).toHaveBeenCalledTimes(1)
    expect(startMinecraft).toHaveBeenCalledTimes(1)

    expect(loadInstallJournal).toHaveBeenCalledWith('proj', expect.any(String), [
      'install.java',
      'install.files',
      'install.mods',
      'install.minecraft',
    ])
    expect(recordInstallStep).toHaveBeenCalledTimes(4)
    expect(clearInstallJournal).toHaveBeenCalledWith('proj')
    expect(setInitialized).toHaveBeenCalledTimes(1)
    expect(coreStore.projectConfig?.initialized).toBe(true)
    expect(useLaunchStore().loginError).toBe('')
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(streamMocks.resetLaunchSteps).toHaveBeenCalledTimes(1)
    expect(streamMocks.flushLaunchSteps).toHaveBeenCalledTimes(1)

    const javaIndex = vi.mocked(downloadJava).mock.invocationCallOrder[0] ?? 0
    const minecraftIndex = vi.mocked(downloadMinecraft).mock.invocationCallOrder[0] ?? 0
    const clearIndex = vi.mocked(clearInstallJournal).mock.invocationCallOrder[0] ?? 0
    const launchIndex = vi.mocked(startMinecraft).mock.invocationCallOrder[0] ?? 0
    expect(javaIndex).toBeLessThan(minecraftIndex)
    expect(launchIndex).toBeLessThan(clearIndex)
  })

  it('prefills the full install plan including the loader step', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(
      makeConfig({ modLoader: 'fabric', initialized: false }),
    )
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue([])

    await useGameLaunch().executeSteps()

    const keys = prefillPlanKeys()
    expect(keys).toContain(STEP_IDS.javaCheck)
    expect(keys).toContain(STEP_IDS.filesDownload)
    expect(keys).toContain(STEP_IDS.modsDownload)
    expect(keys).toContain(STEP_IDS.loader)
    expect(keys).toContain(STEP_IDS.launchWindow)
    expect(keys.filter((key) => key === STEP_IDS.loader)).toHaveLength(1)
  })

  it('keeps only java, minecraft and launch steps for an offline vanilla install', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(
      makeConfig({ online: false, modLoader: 'vanilla', initialized: false }),
    )
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue([])

    await useGameLaunch().executeSteps()

    expect(downloadJava).toHaveBeenCalledTimes(1)
    expect(downloadServerFile).not.toHaveBeenCalled()
    expect(downloadServerMods).not.toHaveBeenCalled()
    expect(downloadMinecraft).toHaveBeenCalledTimes(1)
    expect(startMinecraft).toHaveBeenCalledTimes(1)

    const keys = prefillPlanKeys()
    expect(keys).not.toContain(STEP_IDS.filesDownload)
    expect(keys).not.toContain(STEP_IDS.modsDownload)
    expect(keys).not.toContain(STEP_IDS.loader)
    expect(keys).toContain(STEP_IDS.launchConfig)
  })

  it('uses the launch plan without the journal for an initialized project', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(
      makeConfig({ modLoader: 'fabric', initialized: true }),
    )

    await useGameLaunch().executeSteps()

    expect(downloadServerFile).toHaveBeenCalledTimes(1)
    expect(downloadServerMods).toHaveBeenCalledTimes(1)
    expect(startMinecraft).toHaveBeenCalledTimes(1)
    expect(loadInstallJournal).not.toHaveBeenCalled()
    expect(recordInstallStep).not.toHaveBeenCalled()
    expect(clearInstallJournal).not.toHaveBeenCalled()
    expect(setInitialized).not.toHaveBeenCalled()

    const keys = prefillPlanKeys()
    expect(keys).toContain(STEP_IDS.filesDownload)
    expect(keys).toContain(STEP_IDS.modsDownload)
    expect(keys).toContain(STEP_IDS.launchProcess)
    expect(keys).not.toContain(STEP_IDS.javaCheck)
  })

  it('skips install steps recorded in the journal', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue(['install.java', 'install.files'])

    await useGameLaunch().executeSteps()

    expect(downloadJava).not.toHaveBeenCalled()
    expect(downloadServerFile).not.toHaveBeenCalled()
    expect(downloadServerMods).not.toHaveBeenCalled()
    expect(downloadMinecraft).toHaveBeenCalledTimes(1)
    const recordedKeys = vi.mocked(recordInstallStep).mock.calls.map((call) => call[2])
    expect(recordedKeys).toEqual(['install.minecraft'])
  })

  it('recomputes activeProgress for journal-skipped steps', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue(['install.java'])

    await useGameLaunch().executeSteps()

    const store = useLaunchStore()
    expect(store.launchSteps.filter((step) => step.skipped)).toHaveLength(3)
    expect(store.activeProgress).toBeCloseTo(20, 5)
  })

  it('shows full journal progress when the whole install is skipped', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue([
      'install.java',
      'install.files',
      'install.minecraft',
    ])

    await useGameLaunch().executeSteps()

    const store = useLaunchStore()
    expect(store.launchSteps.filter((step) => step.skipped)).toHaveLength(12)
    expect(store.activeProgress).toBeCloseTo(80, 5)
  })

  it('continues the flow when the journal cannot be read', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockRejectedValue(new Error('journal unreadable'))

    await useGameLaunch().executeSteps()

    expect(downloadJava).toHaveBeenCalledTimes(1)
    expect(downloadMinecraft).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().loginError).toBe('')
  })

  it('continues the flow when recording a journal step fails', async () => {
    useCoreStore().currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))
    vi.mocked(setInitialized).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(loadInstallJournal).mockResolvedValue([])
    vi.mocked(recordInstallStep).mockRejectedValue(new Error('write failed'))

    await useGameLaunch().executeSteps()

    expect(downloadMinecraft).toHaveBeenCalledTimes(1)
    expect(startMinecraft).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
  })

  it('stops and reports a failing install step', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(
      makeConfig({ modLoader: 'fabric', initialized: false }),
    )
    vi.mocked(loadInstallJournal).mockResolvedValue([])
    vi.mocked(downloadServerMods).mockRejectedValue(new Error('download failed'))

    await useGameLaunch().executeSteps()

    expect(useLaunchStore().loginError).toBe('download failed')
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(downloadMinecraft).not.toHaveBeenCalled()
    expect(startMinecraft).not.toHaveBeenCalled()
    expect(clearInstallJournal).not.toHaveBeenCalled()
    expect(setInitialized).not.toHaveBeenCalled()
    expect(streamMocks.flushLaunchSteps).toHaveBeenCalledTimes(1)
  })

  it('reports an initializeProject failure without starting the flow', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    vi.mocked(initializeProject).mockRejectedValue(new Error('server offline'))
    useLaunchStore().prefillSteps([
      { key: STEP_IDS.javaCheck, label: 'Проверка Java' },
      { key: STEP_IDS.javaDownload, label: 'Скачивание Java' },
    ])

    await useGameLaunch().executeSteps()

    expect(useLaunchStore().loginError).toBe('server offline')
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(streamMocks.resetLaunchSteps).toHaveBeenCalledTimes(1)
    expect(streamMocks.prefillLaunchSteps).not.toHaveBeenCalled()
    expect(downloadJava).not.toHaveBeenCalled()
    expect(coreStore.projectConfig).toBeNull()
  })

  it('exits the launcher instead of resetting when closeAfterLaunch is set', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    coreStore.launcherConfig = {
      closeAfterLaunch: true,
    } as typeof coreStore.launcherConfig
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(exitLauncher).mockResolvedValue(undefined)

    await useGameLaunch().executeSteps()

    expect(exitLauncher).toHaveBeenCalledTimes(1)
    expect(streamMocks.resetLaunchSteps).not.toHaveBeenCalled()
  })

  it('reports an exitLauncher failure', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    coreStore.launcherConfig = {
      closeAfterLaunch: true,
    } as typeof coreStore.launcherConfig
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: true }))
    vi.mocked(exitLauncher).mockRejectedValue(new Error('exit failed'))

    await useGameLaunch().executeSteps()

    expect(useLaunchStore().loginError).toBe('exit failed')
    expect(useLaunchStore().isLaunching).toBe(false)
  })

  it('does not apply config or prefill the plan when cancelled during initializeProject', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    let cancelled = false
    vi.mocked(initializeProject).mockImplementation(async () => {
      cancelled = true
      return makeConfig({ initialized: false })
    })

    await useGameLaunch().executeSteps(() => cancelled)

    expect(coreStore.projectConfig).toBeNull()
    expect(streamMocks.prefillLaunchSteps).not.toHaveBeenCalled()
    expect(loadInstallJournal).not.toHaveBeenCalled()
    expect(downloadJava).not.toHaveBeenCalled()
    expect(startMinecraft).not.toHaveBeenCalled()
  })

  it('stops before the flow when cancelled from the start', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))

    await useGameLaunch().executeSteps(() => true)

    expect(coreStore.projectConfig).toBeNull()
    expect(streamMocks.prefillLaunchSteps).not.toHaveBeenCalled()
    expect(downloadJava).not.toHaveBeenCalled()
    expect(startMinecraft).not.toHaveBeenCalled()
  })

  it('reports a setInitialized failure at the end of an install', async () => {
    const coreStore = useCoreStore()
    coreStore.currentProject = 'proj'
    vi.mocked(initializeProject).mockResolvedValue(makeConfig({ initialized: false }))
    vi.mocked(setInitialized).mockRejectedValue(new Error('init failed'))
    vi.mocked(loadInstallJournal).mockResolvedValue([])

    await useGameLaunch().executeSteps()

    expect(startMinecraft).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().loginError).toBe('init failed')
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().activeProgress).toBe(0)
  })
})
