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
    expect(launch.isLaunchCommitted).toBe(false)
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

  it('keeps the derived progress when finalization fails after all steps', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.prefillSteps(PLAN)
    for (const step of launch.launchSteps) step.status = 'done'
    expect(launch.activeProgress).toBe(100)

    launch.failActiveStep('finalization failed')

    expect(launch.loginError).toBe('finalization failed')
    expect(launch.isLaunching).toBe(false)
    expect(launch.launchInterrupted).toBe(false)
    expect(launch.activeProgress).toBe(100)
    expect(launch.launchSteps.every((item) => item.status === 'done')).toBe(true)
  })

  it('derives the progress from applied stream events without a manual recompute', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.prefillSteps(PLAN)
    launch.applyStreamEvent({
      type: 'started',
      id: STEP_IDS.javaCheck,
      label: 'Проверка Java',
    })

    launch.applyStreamEvent({ type: 'finished', id: STEP_IDS.javaCheck, skipped: false })

    expect(launch.activeProgress).toBe(50)
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

  it('commits the launch and drops the pending cancel', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.isCancelPending = true

    launch.commitLaunch()

    expect(launch.isLaunchCommitted).toBe(true)
    expect(launch.isCancelPending).toBe(false)
    expect(launch.isLaunching).toBe(true)
  })

  it('clears the committed flag when the next launch begins', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.commitLaunch()

    const generation = launch.beginLaunch()

    expect(launch.isLaunchCommitted).toBe(false)
    expect(launch.isCurrent(generation)).toBe(true)
  })

  it('clears the committed flag on reset', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.beginLaunch()
    launch.commitLaunch()

    launch.reset()

    expect(launch.isLaunchCommitted).toBe(false)
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

  it('marks journal steps skipped and derives the progress', () => {
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

  it('resets a ghost game session username', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.gameUsernames = ['alice']

    launch.reset()

    expect(launch.gameUsernames).toEqual([])
  })

  it('reconciles the session set through the tracked actions without duplicates', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.gameUsernames = ['ghost']

    launch.setGameSessions(['alice', 'alice', 'bob'])

    expect(launch.gameUsernames).toEqual(['alice', 'bob'])

    launch.setGameSessions(['bob', 'carol'])

    expect(launch.gameUsernames).toEqual(['bob', 'carol'])
  })

  it('tracks concurrent game sessions per account', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()

    launch.addGameSession('alice')
    launch.addGameSession('bob')
    launch.addGameSession('alice')

    expect(launch.gameUsernames).toEqual(['alice', 'bob'])

    launch.removeGameSession('alice')

    expect(launch.gameUsernames).toEqual(['bob'])

    launch.removeGameSession('carol')

    expect(launch.gameUsernames).toEqual(['bob'])
  })

  it('restores the session view when a new launch begins after dismissing it', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.sessionViewDismissed = true

    launch.beginLaunch()

    expect(launch.sessionViewDismissed).toBe(false)
  })

  it('clears the dismissed session view on reset', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.sessionViewDismissed = true

    launch.reset()

    expect(launch.sessionViewDismissed).toBe(false)
  })

  it('keeps the dismissed session view while no new launch begins', () => {
    setActivePinia(createPinia())
    const launch = useLaunchStore()
    launch.sessionViewDismissed = true
    launch.gameUsernames = []

    expect(launch.sessionViewDismissed).toBe(true)
  })
})
