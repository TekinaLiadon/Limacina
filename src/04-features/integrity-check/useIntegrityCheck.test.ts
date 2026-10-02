import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useCoreStore,
  useNotificationStore,
  type IntegrityReport,
  type ProjectConfig,
  type StepEvent,
} from '@/05-entities'
import { STEP_IDS } from '@/06-shared'
import { useIntegrityCheck } from './useIntegrityCheck'
import { withSetup } from '@/test-support/withSetup'

const api = vi.hoisted(() => ({
  checkFilesIntegrity: vi.fn(),
  listenIntegritySteps: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  checkFilesIntegrity: api.checkFilesIntegrity,
  listenIntegritySteps: api.listenIntegritySteps,
}))

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
  legacy: false,
  legacyProfile: null,
})

const makeReport = (failed: string[] = []): IntegrityReport => ({
  total: 10,
  broken: failed.length,
  repaired: 0,
  missing: 0,
  failed,
})

describe('useIntegrityCheck', () => {
  let emitStep: ((event: StepEvent) => void) | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    emitStep = undefined
    api.checkFilesIntegrity.mockReset()
    api.listenIntegritySteps.mockReset()
    api.listenIntegritySteps.mockImplementation(async (handler: (event: StepEvent) => void) => {
      emitStep = handler
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupCheck = (): ReturnType<typeof useIntegrityCheck> => {
    const { result } = withSetup(() => useIntegrityCheck())
    return result
  }

  const deferredReport = (): { pending: Promise<void>; release: () => void } => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    api.checkFilesIntegrity.mockImplementationOnce(async () => {
      await pending
      return makeReport()
    })
    return { pending, release }
  }

  it('prefills the full plan for an online project and stores the report', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const check = setupCheck()

    const pending = check.handleCheck()
    expect(check.isChecking.value).toBe(true)
    expect(check.steps.value.map((step) => step.key)).toEqual([
      STEP_IDS.mcManifest,
      STEP_IDS.mcJar,
      STEP_IDS.mcLibs,
      STEP_IDS.mcAssetsIndex,
      STEP_IDS.mcAssets,
      STEP_IDS.filesCheck,
      STEP_IDS.modsCheck,
    ])
    expect(check.steps.value.every((step) => step.status === 'pending')).toBe(true)

    await pending

    expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(1)
    expect(check.isChecking.value).toBe(false)
    expect(check.report.value).toEqual(makeReport())
    expect(check.hasResult.value).toBe(true)
    expect(check.errorMessage.value).toBe('')
  })

  it('drops the server steps for an offline project', async () => {
    useCoreStore().projectConfig = makeProjectConfig(false)
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const check = setupCheck()

    await check.handleCheck()

    expect(check.steps.value.map((step) => step.key)).not.toContain(STEP_IDS.filesCheck)
    expect(check.steps.value).toHaveLength(5)
  })

  it('applies step events while the check is running', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    const { release } = deferredReport()
    const check = setupCheck()

    const pending = check.handleCheck()
    emitStep?.({ type: 'started', id: STEP_IDS.mcJar, label: 'Клиент игры' })
    emitStep?.({ type: 'progress', id: STEP_IDS.mcJar, current: 3, total: 10 })
    emitStep?.({ type: 'finished', id: STEP_IDS.mcJar, skipped: false })
    emitStep?.({ type: 'started', id: STEP_IDS.mcLibs, label: 'Библиотеки игры' })
    emitStep?.({ type: 'failed', id: STEP_IDS.mcLibs, message: 'сеть недоступна' })

    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcManifest)?.status).toBe('done')
    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcJar)?.status).toBe('done')
    const libs = check.steps.value.find((step) => step.key === STEP_IDS.mcLibs)
    expect(libs?.status).toBe('error')
    expect(libs?.error).toBe('сеть недоступна')
    expect(check.progress.value).toBeGreaterThan(0)
    expect(check.progress.value).toBeLessThan(100)

    release()
    await pending
  })

  it('ignores step events after the check completes', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const check = setupCheck()

    await check.handleCheck()
    emitStep?.({ type: 'started', id: STEP_IDS.mcJar, label: 'Клиент игры' })

    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcJar)?.status).toBe('pending')
  })

  it('surfaces the command error and shows a toast for the hidden popup', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockRejectedValue(new Error('ipc down'))
    const check = setupCheck()

    const pending = check.handleCheck()
    check.closeResult()
    await pending

    expect(check.errorMessage.value).toBe('ipc down')
    expect(check.report.value).toBeNull()
    expect(check.hasResult.value).toBe(true)
    expect(check.isChecking.value).toBe(false)
    expect(useNotificationStore().message).toBe('Проверка целостности не удалась: ipc down')
  })

  it('keeps the error without a toast while the popup is visible', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockRejectedValue(new Error('ipc down'))
    const check = setupCheck()

    await check.handleCheck()

    expect(check.errorMessage.value).toBe('ipc down')
    expect(useNotificationStore().visible).toBe(false)
  })

  it('keeps the popup hidden and toasts the summary when closed mid-check', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockResolvedValue(makeReport(['client.jar', 'notes.txt']))
    const check = setupCheck()

    const pending = check.handleCheck()
    check.closeResult()
    expect(check.isPopupHidden.value).toBe(true)
    expect(check.steps.value).toHaveLength(7)

    await pending

    expect(check.report.value).not.toBeNull()
    expect(useNotificationStore().message).toBe('Проверка целостности: не удалось восстановить 2 файлов')
  })

  it('toasts the all-good summary when the popup was hidden', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const check = setupCheck()

    const pending = check.handleCheck()
    check.closeResult()
    await pending

    expect(useNotificationStore().message).toBe('Проверка целостности: все файлы в порядке')
  })

  it('clears the result on close after completion', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const check = setupCheck()

    await check.handleCheck()
    check.closeResult()

    expect(check.report.value).toBeNull()
    expect(check.errorMessage.value).toBe('')
    expect(check.steps.value).toHaveLength(0)
    expect(check.hasResult.value).toBe(false)
    expect(check.isPopupHidden.value).toBe(true)
  })

  it('does not start a second check while one is running', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    api.checkFilesIntegrity.mockReturnValue(new Promise(() => {}))
    const check = setupCheck()

    void check.handleCheck()
    await check.handleCheck()

    expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(1)
  })
})
