import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { STEP_IDS, type StepPlanItem } from '@/06-shared'
import { useLaunchStore, type StepEvent } from '@/05-entities'

const PLAN: StepPlanItem[] = [
  { key: STEP_IDS.javaCheck, label: 'Проверка Java' },
  { key: STEP_IDS.javaDownload, label: 'Скачивание Java' },
]

const stepEvent = (partial: StepEvent): StepEvent => partial

describe('useLaunchStore', () => {
  it('starts idle with no steps and no login error', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    expect(launch.isLaunching).toBe(false)
    expect(launch.launchInterrupted).toBe(false)
    expect(launch.isCancelPending).toBe(false)
    expect(launch.launchGeneration).toBe(0)
    expect(launch.launchSteps).toEqual([])
    expect(launch.activeProgress).toBe(0)
    expect(launch.loginError).toBe('')
  })

  it('begins a launch atomically and returns the fresh generation', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.isCancelPending = true

    const generation = launch.beginLaunch()

    expect(generation).toBe(1)
    expect(launch.isLaunching).toBe(true)
    expect(launch.isCancelPending).toBe(false)
    expect(launch.isCurrent(generation)).toBe(true)
  })

  it('invalidates the generation without touching the launching flag', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    const generation = launch.beginLaunch()

    launch.invalidateGeneration()

    expect(launch.isLaunching).toBe(true)
    expect(launch.isCurrent(generation)).toBe(false)
  })

  it('reports a failure only for the current generation', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    const generation = launch.beginLaunch()
    launch.invalidateGeneration()

    launch.reportFailure(generation, 'stale')

    expect(launch.loginError).toBe('')
    expect(launch.isLaunching).toBe(true)

    const fresh = launch.beginLaunch()
    launch.reportFailure(fresh, 'java missing')

    expect(launch.loginError).toBe('java missing')
    expect(launch.isLaunching).toBe(false)
  })

  it('marks the active step failed and stops the launch', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.prefillSteps(PLAN)
    const step = launch.launchSteps.find((item) => item.key === STEP_IDS.javaCheck)
    if (step) step.status = 'active'

    launch.failActiveStep('download failed')

    expect(step?.status).toBe('error')
    expect(step?.error).toBe('download failed')
    expect(launch.loginError).toBe('download failed')
    expect(launch.isLaunching).toBe(false)
  })

  it('keeps the login error when no step is active', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()

    launch.failActiveStep('server offline')

    expect(launch.loginError).toBe('server offline')
    expect(launch.isLaunching).toBe(false)
    expect(launch.activeProgress).toBe(0)
  })

  it('reflects a failure after all steps in the progress state', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.prefillSteps(PLAN)
    for (const step of launch.launchSteps) step.status = 'done'
    launch.recomputeProgress()
    expect(launch.activeProgress).toBe(100)

    launch.failActiveStep('finalization failed')

    expect(launch.loginError).toBe('finalization failed')
    expect(launch.isLaunching).toBe(false)
    expect(launch.launchInterrupted).toBe(false)
    expect(launch.activeProgress).toBe(0)
    expect(launch.launchSteps.every((item) => item.status === 'done')).toBe(true)
  })

  it('finishes the launch without clearing the error', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    const generation = launch.beginLaunch()
    launch.loginError = 'kept'

    launch.finishLaunch()

    expect(launch.isLaunching).toBe(false)
    expect(launch.loginError).toBe('kept')
    void generation
  })

  it('cancels the launch and clears the error', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.isCancelPending = true
    launch.loginError = 'boom'

    launch.cancelLaunch()

    expect(launch.isLaunching).toBe(false)
    expect(launch.isCancelPending).toBe(false)
    expect(launch.loginError).toBe('')
  })

  it('marks an interrupted launch with an empty progress', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()

    launch.markInterrupted()

    expect(launch.isLaunching).toBe(true)
    expect(launch.launchInterrupted).toBe(true)
    expect(launch.launchSteps).toEqual([])
    expect(launch.activeProgress).toBe(0)
  })

  it('prefills the plan as pending steps and clears the interruption', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.markInterrupted()

    launch.prefillSteps(PLAN)

    expect(launch.launchSteps).toHaveLength(2)
    expect(launch.launchSteps.every((item) => item.status === 'pending')).toBe(true)
    expect(launch.launchSteps.map((item) => item.label)).toEqual([
      'Проверка Java',
      'Скачивание Java',
    ])
    expect(launch.activeProgress).toBe(0)
    expect(launch.launchInterrupted).toBe(false)
  })

  it('applies a stream event and keeps the terminal state owned by the action', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.prefillSteps(PLAN)
    const started: StepEvent = stepEvent({
      type: 'started',
      id: STEP_IDS.javaCheck,
      label: 'Проверка Java',
    })

    launch.applyStreamEvent(started)

    const active = launch.launchSteps.find((item) => item.key === STEP_IDS.javaCheck)
    expect(active?.status).toBe('active')

    launch.applyStreamEvent(
      stepEvent({ type: 'failed', id: STEP_IDS.javaCheck, message: 'broken' }),
    )

    expect(active?.status).toBe('error')
    expect(active?.error).toBe('broken')
    expect(launch.isLaunching).toBe(true)
    expect(launch.loginError).toBe('')
  })

  it('marks journal steps skipped and recomputes the progress', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.prefillSteps(PLAN)

    launch.markStepsSkipped(new Set([STEP_IDS.javaCheck, STEP_IDS.javaDownload]))

    expect(launch.launchSteps.every((item) => item.status === 'done' && item.skipped)).toBe(true)
    expect(launch.activeProgress).toBe(100)
  })

  it('resets the steps but keeps the launching flag', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.prefillSteps(PLAN)

    launch.resetSteps()

    expect(launch.isLaunching).toBe(true)
    expect(launch.launchSteps).toEqual([])
    expect(launch.activeProgress).toBe(0)
    expect(launch.launchInterrupted).toBe(false)
  })

  it('resets the whole pipeline state', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.prefillSteps(PLAN)
    launch.isCancelPending = true
    launch.loginError = 'boom'

    launch.reset()

    expect(launch.isLaunching).toBe(false)
    expect(launch.launchInterrupted).toBe(false)
    expect(launch.isCancelPending).toBe(false)
    expect(launch.launchSteps).toEqual([])
    expect(launch.activeProgress).toBe(0)
    expect(launch.loginError).toBe('')
  })
})
