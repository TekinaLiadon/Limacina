import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useCoreStore,
  useLaunchStore,
  useNotificationStore,
  type IntegrityReport,
  type StepEvent,
} from '@/05-entities'
import { STEP_IDS } from '@/06-shared'
import { withSetup } from '@/test-support/withSetup'
import { makeProjectConfig } from '@/test-support/fixtures'
import type { useIntegrityCheck } from '../useIntegrityCheck'

const api = vi.hoisted(() => ({
  checkFilesIntegrity: vi.fn(),
  listenIntegritySteps: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  checkFilesIntegrity: api.checkFilesIntegrity,
  listenIntegritySteps: api.listenIntegritySteps,
}))

const makeReport = (failed: string[] = []): IntegrityReport => ({
  total: 10,
  broken: failed.length,
  repaired: 0,
  missing: 0,
  failed,
})

type IntegrityCheckComposable = ReturnType<typeof useIntegrityCheck>

describe('useIntegrityCheck', () => {
  let emitStep: ((event: StepEvent) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
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

  const setupCheck = async (): Promise<{ check: IntegrityCheckComposable; unmount: () => void }> => {
    const { useIntegrityCheck: loadIntegrityCheck } = await import('../useIntegrityCheck')
    const { result, unmount } = withSetup(() => loadIntegrityCheck())
    return { check: result, unmount }
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
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    const pending = check.handleCheck()
    expect(check.isChecking.value).toBe(true)
    expect(check.steps.value.map((step) => step.key)).toEqual([
      STEP_IDS.mcManifest,
      STEP_IDS.mcJar,
      STEP_IDS.mcLibs,
      STEP_IDS.mcNatives,
      STEP_IDS.mcAssetsIndex,
      STEP_IDS.mcAssets,
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

  it('derives the report summary and the running phase', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
    api.checkFilesIntegrity.mockResolvedValue(makeReport(['a', 'b']))
    const { check } = await setupCheck()

    expect(check.isCheckingNow.value).toBe(false)
    expect(check.hasErrors.value).toBe(false)
    expect(check.isClean.value).toBe(false)
    expect(check.resultText.value).toBe('')

    const pending = check.handleCheck()
    expect(check.isCheckingNow.value).toBe(true)

    await pending

    expect(check.isCheckingNow.value).toBe(false)
    expect(check.hasErrors.value).toBe(true)
    expect(check.isClean.value).toBe(false)
    expect(check.resultText.value).toBe('проверено: 10, повреждено: 2')
  })

  it('lists only the non-zero counters in the report summary', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
    api.checkFilesIntegrity.mockResolvedValue({ total: 10, broken: 0, repaired: 3, missing: 2, failed: [] })
    const { check } = await setupCheck()

    await check.handleCheck()

    expect(check.hasErrors.value).toBe(false)
    expect(check.isClean.value).toBe(true)
    expect(check.resultText.value).toBe('проверено: 10, отсутствовало: 2, восстановлено: 3')
  })

  it('drops the server steps for an offline project', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    await check.handleCheck()

    expect(check.steps.value.map((step) => step.key)).not.toContain(STEP_IDS.modsCheck)
    expect(check.steps.value).toHaveLength(6)
  })

  it('prefills only the vanilla plan while the project config is missing', async () => {
    useCoreStore().projectConfig = null
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    await check.handleCheck()

    expect(check.steps.value.map((step) => step.key)).not.toContain(STEP_IDS.modsCheck)
    expect(check.steps.value).toHaveLength(6)
  })

  it('applies natives events to the planned step instead of appending it untracked', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
    const { release } = deferredReport()
    const { check } = await setupCheck()

    const pending = check.handleCheck()
    emitStep?.({ type: 'started', id: STEP_IDS.mcNatives, label: 'Нативные библиотеки' })
    emitStep?.({ type: 'progress', id: STEP_IDS.mcNatives, current: 2, total: 3 })
    emitStep?.({ type: 'finished', id: STEP_IDS.mcNatives, skipped: false })

    expect(check.steps.value.map((step) => step.key)).toEqual([
      STEP_IDS.mcManifest,
      STEP_IDS.mcJar,
      STEP_IDS.mcLibs,
      STEP_IDS.mcNatives,
      STEP_IDS.mcAssetsIndex,
      STEP_IDS.mcAssets,
    ])
    const natives = check.steps.value.find((step) => step.key === STEP_IDS.mcNatives)
    expect(natives?.status).toBe('done')
    expect(natives?.untracked).toBe(false)

    release()
    await pending
  })

  it('applies step events while the check is running', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    const { release } = deferredReport()
    const { check } = await setupCheck()

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
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    await check.handleCheck()
    emitStep?.({ type: 'started', id: STEP_IDS.mcJar, label: 'Клиент игры' })

    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcJar)?.status).toBe('pending')
  })

  it('aborts with a toast and a clean state when the project switches mid-check', async () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig({ online: true })
    core.currentProject = 'alpha'
    const { release } = deferredReport()
    const { check } = await setupCheck()

    const pending = check.handleCheck()
    core.currentProject = 'beta'
    emitStep?.({ type: 'started', id: STEP_IDS.mcJar, label: 'Клиент игры' })

    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcJar)?.status).toBe('pending')

    release()
    await pending

    expect(useNotificationStore().message).toBe('Проверка целостности прервана: проект переключён')
    expect(check.report.value).toBeNull()
    expect(check.errorMessage.value).toBe('')
    expect(check.steps.value).toHaveLength(0)
    expect(check.hasResult.value).toBe(false)
    expect(check.isChecking.value).toBe(false)
  })

  it('shares the running progress and the final result with a second composable instance', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    const { release } = deferredReport()
    const first = await setupCheck()

    const pending = first.check.handleCheck()
    const second = await setupCheck()

    expect(second.check.isChecking.value).toBe(true)
    expect(second.check.isCheckingNow.value).toBe(true)
    expect(second.check.steps.value).toHaveLength(7)
    emitStep?.({ type: 'started', id: STEP_IDS.mcJar, label: 'Клиент игры' })
    expect(second.check.steps.value.find((step) => step.key === STEP_IDS.mcJar)?.status).toBe('active')

    release()
    await pending

    expect(second.check.report.value).toEqual(makeReport())
    expect(second.check.hasResult.value).toBe(true)
    expect(second.check.isChecking.value).toBe(false)
  })

  it('applies step events and the report on a rerun after the project switches between checks', async () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig({ online: true })
    core.currentProject = 'alpha'
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    await check.handleCheck()

    core.currentProject = 'beta'
    const pending = check.handleCheck()
    emitStep?.({ type: 'started', id: STEP_IDS.mcJar, label: 'Клиент игры' })
    emitStep?.({ type: 'finished', id: STEP_IDS.mcJar, skipped: false })

    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcManifest)?.status).toBe('done')
    expect(check.steps.value.find((step) => step.key === STEP_IDS.mcJar)?.status).toBe('done')

    await pending

    expect(api.listenIntegritySteps).toHaveBeenCalledTimes(1)
    expect(check.report.value).toEqual(makeReport())
  })

  it('surfaces the command error and shows a toast for the hidden popup', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockRejectedValue(new Error('ipc down'))
    const { check } = await setupCheck()

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
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockRejectedValue(new Error('ipc down'))
    const { check } = await setupCheck()

    await check.handleCheck()

    expect(check.errorMessage.value).toBe('ipc down')
    expect(useNotificationStore().visible).toBe(false)
  })

  it('keeps the popup hidden and toasts the summary when closed mid-check', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockResolvedValue(makeReport(['client.jar', 'notes.txt']))
    const { check } = await setupCheck()

    const pending = check.handleCheck()
    check.closeResult()
    expect(check.isPopupHidden.value).toBe(true)
    expect(check.steps.value).toHaveLength(7)

    await pending

    expect(check.report.value).not.toBeNull()
    expect(useNotificationStore().message).toBe('Проверка целостности: не удалось восстановить 2 файла')
  })

  it('toasts the all-good summary when the popup was hidden', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    const pending = check.handleCheck()
    check.closeResult()
    await pending

    expect(useNotificationStore().message).toBe('Проверка целостности: все файлы в порядке')
  })

  it('clears the result on close after completion', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    const { check } = await setupCheck()

    await check.handleCheck()
    check.closeResult()

    expect(check.report.value).toBeNull()
    expect(check.errorMessage.value).toBe('')
    expect(check.steps.value).toHaveLength(0)
    expect(check.hasResult.value).toBe(false)
    expect(check.isPopupHidden.value).toBe(true)
  })

  it('does not start a second check while one is running', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    api.checkFilesIntegrity.mockReturnValue(new Promise(() => {}))
    const { check } = await setupCheck()

    void check.handleCheck()
    await check.handleCheck()

    expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(1)
  })

  it('does not start a second backend check after remount while one is running', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    const { release } = deferredReport()
    const first = await setupCheck()
    const pending = first.check.handleCheck()
    await vi.waitFor(() => expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(1))
    first.unmount()

    const second = await setupCheck()
    await second.check.handleCheck()

    expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(1)
    expect(useNotificationStore().message).toBe('Проверка целостности уже выполняется')

    release()
    await pending

    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    await second.check.handleCheck()

    expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(2)
    expect(second.check.report.value).toEqual(makeReport())
  })

  it('blocks the check while the game launch is running and allows it after', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: true })
    useLaunchStore().beginLaunch()
    const { check } = await setupCheck()

    await check.handleCheck()

    expect(api.checkFilesIntegrity).not.toHaveBeenCalled()
    expect(api.listenIntegritySteps).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe('Идёт запуск игры, проверка целостности недоступна')

    useLaunchStore().finishLaunch()
    api.checkFilesIntegrity.mockResolvedValue(makeReport())
    await check.handleCheck()

    expect(api.checkFilesIntegrity).toHaveBeenCalledTimes(1)
    expect(check.report.value).toEqual(makeReport())
  })
})
