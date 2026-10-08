import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { STEP_IDS, type StepPlanItem } from '@/06-shared'
import { useLaunchStore, useCoreStore, type StepEvent } from '@/05-entities'

const api = vi.hoisted(() => ({
  listenLaunchSteps: vi.fn(),
  getLaunchState: vi.fn(),
  syncGameSession: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listenLaunchSteps: api.listenLaunchSteps,
  getLaunchState: api.getLaunchState,
}))

vi.mock('../../game-session/useGameSession', () => ({
  syncGameSession: api.syncGameSession,
}))

interface StreamApi {
  startLaunchStepsStream: () => Promise<void>
  prefillLaunchSteps: (plan: StepPlanItem[]) => void
  resetLaunchSteps: () => void
  flushLaunchSteps: () => Promise<void>
}

const loadStream = async (): Promise<StreamApi> => {
  const { useLaunchStepsStream } = await import('../useLaunchStepsStream')
  return useLaunchStepsStream()
}

const PLAN = [
  { key: STEP_IDS.javaCheck, label: 'Проверка Java' },
  { key: STEP_IDS.javaDownload, label: 'Скачивание Java' },
  { key: STEP_IDS.javaExtract, label: 'Распаковка Java' },
]

const startedEvent = (id: string, label = id): StepEvent => ({ type: 'started', id, label })

const finishedEvent = (id: string): StepEvent => ({ type: 'finished', id, skipped: false })

describe('useLaunchStepsStream', () => {
  let emit: ((event: StepEvent) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.listenLaunchSteps.mockReset()
    api.getLaunchState.mockReset()
    api.syncGameSession.mockReset()
    api.syncGameSession.mockResolvedValue(undefined)
    api.listenLaunchSteps.mockImplementation(async (handler: (event: StepEvent) => void) => {
      emit = handler
      return () => {}
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const startStream = async (): Promise<StreamApi> => {
    const stream = await loadStream()
    await stream.startLaunchStepsStream()
    return stream
  }

  it('subscribes to the event stream once', async () => {
    const stream = await startStream()
    await stream.startLaunchStepsStream()
    expect(api.listenLaunchSteps).toHaveBeenCalledTimes(1)
  })

  it('resubscribes after a failed subscription', async () => {
    api.listenLaunchSteps.mockRejectedValueOnce(new Error('ipc down'))
    await startStream()
    await startStream()
    expect(api.listenLaunchSteps).toHaveBeenCalledTimes(2)
  })

  it('marks an interrupted launch when the backend reports one', async () => {
    api.getLaunchState.mockResolvedValue(true)
    await startStream()
    const store = useLaunchStore()

    expect(store.isLaunching).toBe(true)
    expect(store.launchInterrupted).toBe(true)
    expect(store.launchSteps).toEqual([])
    expect(store.activeProgress).toBe(0)
  })

  it('skips the interrupted marker when a session is already running', async () => {
    api.getLaunchState.mockResolvedValue(true)
    useCoreStore().gameUsername = 'user'
    await startStream()

    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().launchInterrupted).toBe(false)
  })

  it('skips the interrupted marker while a launch is already active', async () => {
    api.getLaunchState.mockResolvedValue(true)
    useLaunchStore().isLaunching = true
    await startStream()

    expect(useLaunchStore().launchInterrupted).toBe(false)
  })

  it('waits for the session hydration before marking an interrupted launch', async () => {
    let resolveSync: (() => void) = () => {}
    api.syncGameSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve
        }),
    )
    api.getLaunchState.mockResolvedValue(true)

    const pending = startStream()
    await vi.advanceTimersByTimeAsync(0)

    expect(api.syncGameSession).toHaveBeenCalledTimes(1)
    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().launchInterrupted).toBe(false)

    useCoreStore().gameUsername = 'alice'
    resolveSync()
    await pending

    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().launchInterrupted).toBe(false)
  })

  it('still marks the interrupted launch when the session sync fails', async () => {
    api.syncGameSession.mockRejectedValue(new Error('ipc down'))
    api.getLaunchState.mockResolvedValue(true)
    await startStream()

    expect(useLaunchStore().isLaunching).toBe(true)
    expect(useLaunchStore().launchInterrupted).toBe(true)
  })

  it('ignores hydrate failures and keeps the state clean', async () => {
    api.getLaunchState.mockRejectedValue(new Error('ipc down'))
    await startStream()

    expect(useLaunchStore().isLaunching).toBe(false)
    expect(useLaunchStore().launchInterrupted).toBe(false)
  })

  it('prefills the plan as pending steps and resets progress', async () => {
    const stream = await loadStream()
    const store = useLaunchStore()
    store.isLaunching = true
    store.launchInterrupted = true

    stream.prefillLaunchSteps(PLAN)

    expect(store.launchSteps).toHaveLength(3)
    expect(store.launchSteps.every((step) => step.status === 'pending')).toBe(true)
    expect(store.launchSteps.map((step) => step.key)).toEqual(PLAN.map((item) => item.key))
    expect(store.activeProgress).toBe(0)
    expect(store.launchInterrupted).toBe(false)
  })

  it('applies started, progress and finished events in order', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck, 'Проверка Java'))
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })
    expect(store.launchSteps[1]).toMatchObject({ status: 'pending' })

    emit?.({ type: 'progress', id: STEP_IDS.javaCheck, current: 5, total: 10 })
    emit?.({ type: 'detail', id: STEP_IDS.javaCheck, text: 'jdk.zip' })
    expect(store.launchSteps[0]).toMatchObject({ current: 5, total: 10, detail: 'jdk.zip' })

    emit?.(finishedEvent(STEP_IDS.javaCheck))
    await vi.advanceTimersByTimeAsync(1_000)
    emit?.(startedEvent(STEP_IDS.javaDownload, 'Скачивание Java'))

    expect(store.launchSteps[0]).toMatchObject({ status: 'done', skipped: false })
    expect(store.launchSteps[1]).toMatchObject({ status: 'active' })
    expect(store.activeProgress).toBeCloseTo(100 / 3, 1)
  })

  it('holds a finished event for the minimum display time', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })

    await vi.advanceTimersByTimeAsync(499)
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })

    await vi.advanceTimersByTimeAsync(1)
    expect(store.launchSteps[0]).toMatchObject({ status: 'done' })
  })

  it('paces a rapid event burst at exact 500ms display intervals', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    emit?.(startedEvent(STEP_IDS.javaDownload))
    emit?.(finishedEvent(STEP_IDS.javaDownload))
    emit?.(startedEvent(STEP_IDS.javaExtract))

    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })
    expect(store.launchSteps[1]).toMatchObject({ status: 'pending' })
    expect(store.launchSteps[2]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(499)
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })
    expect(store.launchSteps[1]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(1)
    expect(store.launchSteps[0]).toMatchObject({ status: 'done' })
    expect(store.launchSteps[1]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(499)
    expect(store.launchSteps[1]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(1)
    expect(store.launchSteps[0]).toMatchObject({ status: 'done' })
    expect(store.launchSteps[1]).toMatchObject({ status: 'active' })
    expect(store.launchSteps[2]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(499)
    expect(store.launchSteps[1]).toMatchObject({ status: 'active' })

    await vi.advanceTimersByTimeAsync(1)
    expect(store.launchSteps[1]).toMatchObject({ status: 'done' })
    expect(store.launchSteps[2]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(499)
    expect(store.launchSteps[2]).toMatchObject({ status: 'pending' })

    await vi.advanceTimersByTimeAsync(1)
    expect(store.launchSteps[2]).toMatchObject({ status: 'active' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops queued events when the launch generation changes', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })

    store.launchGeneration += 1
    await vi.advanceTimersByTimeAsync(1_000)

    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('prefill cancels the pending hold timer and discards held events', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })

    store.launchGeneration += 1
    stream.prefillLaunchSteps(PLAN)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(store.launchSteps.map((step) => step.status)).toEqual(['pending', 'pending', 'pending'])
    expect(vi.getTimerCount()).toBe(0)

    emit?.(startedEvent(STEP_IDS.javaDownload))
    expect(store.launchSteps[1]).toMatchObject({ status: 'active' })
  })

  it('resetLaunchSteps cancels a pending hold timer', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })

    stream.resetLaunchSteps()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(store.launchSteps).toEqual([])

    emit?.(startedEvent(STEP_IDS.javaDownload))
    expect(store.launchSteps).toEqual([])
  })

  it('flushes held events immediately on demand', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps[0]).toMatchObject({ status: 'active' })

    const flushPromise = stream.flushLaunchSteps()
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromise

    expect(store.launchSteps[0]).toMatchObject({ status: 'done' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops the queue on a failed event and marks only the step', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)
    store.isLaunching = true
    store.launchInterrupted = true

    emit?.(startedEvent(STEP_IDS.javaCheck))
    await vi.advanceTimersByTimeAsync(1_000)
    emit?.({ type: 'failed', id: STEP_IDS.javaCheck, message: 'Скачивание сорвалось' })
    await vi.advanceTimersByTimeAsync(1_000)
    emit?.(startedEvent(STEP_IDS.javaDownload))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(store.launchSteps[0]).toMatchObject({
      status: 'error',
      error: 'Скачивание сорвалось',
    })
    expect(store.isLaunching).toBe(true)
    expect(store.launchInterrupted).toBe(true)
    expect(store.loginError).toBe('')
    expect(store.launchSteps[1]).toMatchObject({ status: 'pending' })
  })

  it('ignores events before a prefill', async () => {
    await startStream()
    const store = useLaunchStore()

    emit?.(startedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps).toEqual([])
  })

  it('ignores events from a stale launch generation', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)
    store.launchGeneration += 1

    emit?.(startedEvent(STEP_IDS.javaCheck))
    expect(store.launchSteps[0]).toMatchObject({ status: 'pending' })
  })

  it('resetLaunchSteps clears steps, progress and the queue state', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    await vi.advanceTimersByTimeAsync(1_000)
    emit?.({ type: 'failed', id: STEP_IDS.javaCheck, message: 'boom' })
    await vi.advanceTimersByTimeAsync(1_000)

    stream.resetLaunchSteps()

    expect(store.launchSteps).toEqual([])
    expect(store.activeProgress).toBe(0)
    expect(store.launchInterrupted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    emit?.(startedEvent(STEP_IDS.javaDownload))
    expect(store.launchSteps).toEqual([])
  })

  it('computes progress from done steps and the active fraction', async () => {
    const stream = await startStream()
    const store = useLaunchStore()
    stream.prefillLaunchSteps(PLAN)

    emit?.(startedEvent(STEP_IDS.javaCheck))
    emit?.(finishedEvent(STEP_IDS.javaCheck))
    await vi.advanceTimersByTimeAsync(1_000)
    emit?.(startedEvent(STEP_IDS.javaDownload))
    emit?.({ type: 'progress', id: STEP_IDS.javaDownload, current: 25, total: 100 })

    expect(store.activeProgress).toBeCloseTo((100 + 25) / 3, 1)
  })
})
