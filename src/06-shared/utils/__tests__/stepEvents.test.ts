import { describe, expect, it } from 'vitest'
import { applyStepEvent, computeStepProgress, createStepItem, type StepProgressItem } from '../stepEvents'
import type { StepEvent } from '../../types'

const pendingStep = (key: string): StepProgressItem => ({
  ...createStepItem(key, `label-${key}`, 0),
  status: 'pending',
})

const doneStep = (key: string): StepProgressItem => ({ ...pendingStep(key), status: 'done' })

const errorStep = (key: string): StepProgressItem => ({ ...pendingStep(key), status: 'error' })

const activeStep = (key: string, current: number, total: number): StepProgressItem => ({
  ...pendingStep(key),
  status: 'active',
  current,
  total,
})

const stepById = (steps: StepProgressItem[], key: string): StepProgressItem => {
  const step = steps.find((item) => item.key === key)
  if (step === undefined) throw new Error(`missing step ${key}`)
  return step
}

const emit = (steps: StepProgressItem[], event: StepEvent): void => applyStepEvent(steps, event)

describe('createStepItem', () => {
  it('creates an active step with zeroed progress', () => {
    expect(createStepItem('mc.jar', 'Клиент игры', 123)).toEqual({
      key: 'mc.jar',
      label: 'Клиент игры',
      status: 'active',
      skipped: false,
      untracked: false,
      current: 0,
      total: 0,
      detail: '',
      error: '',
      shownAt: 123,
    })
  })
})

describe('applyStepEvent', () => {
  it('started closes a previous active step left open by a lost finish', () => {
    const steps = [pendingStep('a'), pendingStep('b')]
    emit(steps, { type: 'started', id: 'a', label: 'A' })
    emit(steps, { type: 'started', id: 'b', label: 'B' })
    expect(stepById(steps, 'a')).toMatchObject({ status: 'done', skipped: true })
    expect(stepById(steps, 'b').status).toBe('active')
    expect(steps).toHaveLength(2)
  })

  it('started marks earlier pending steps as done and skipped', () => {
    const steps = [pendingStep('a'), pendingStep('b'), pendingStep('c')]
    emit(steps, { type: 'started', id: 'c', label: 'C' })
    expect(stepById(steps, 'a')).toMatchObject({ status: 'done', skipped: true })
    expect(stepById(steps, 'b')).toMatchObject({ status: 'done', skipped: true })
    expect(stepById(steps, 'c').status).toBe('active')
  })

  it('started appends an unknown step marked as untracked instead of failing', () => {
    const steps = [pendingStep('a')]
    emit(steps, { type: 'started', id: 'unexpected', label: 'Unexpected' })
    expect(steps).toHaveLength(2)
    expect(stepById(steps, 'unexpected')).toMatchObject({ status: 'active', untracked: true })
  })

  it('started appends an unknown step and resolves the earlier pending steps', () => {
    const steps = [pendingStep('a'), pendingStep('b')]
    emit(steps, { type: 'started', id: 'unexpected', label: 'Unexpected' })
    expect(stepById(steps, 'a')).toMatchObject({ status: 'done', skipped: true })
    expect(stepById(steps, 'b')).toMatchObject({ status: 'done', skipped: true })
    expect(stepById(steps, 'unexpected').status).toBe('active')

    emit(steps, { type: 'finished', id: 'unexpected', skipped: false })
    expect(computeStepProgress(steps)).toBe(100)
  })

  it('started re-activates an existing step with a fresh label', () => {
    const steps = [doneStep('a')]
    emit(steps, { type: 'started', id: 'a', label: 'Retry label' })
    expect(stepById(steps, 'a')).toMatchObject({ status: 'active', label: 'Retry label' })
  })

  it('an unknown appended step does not distort the progress denominator', () => {
    const steps = [pendingStep('a'), pendingStep('b')]
    emit(steps, { type: 'started', id: 'a', label: 'A' })
    emit(steps, { type: 'finished', id: 'a', skipped: false })
    emit(steps, { type: 'started', id: 'b', label: 'B' })
    emit(steps, { type: 'progress', id: 'b', current: 5, total: 10 })
    expect(computeStepProgress(steps)).toBeCloseTo(75, 5)

    emit(steps, { type: 'started', id: 'unexpected', label: 'Unexpected' })

    expect(computeStepProgress(steps)).toBe(100)

    emit(steps, { type: 'finished', id: 'b', skipped: false })
    expect(computeStepProgress(steps)).toBe(100)
  })

  it('progress updates counters and ignores unknown ids', () => {
    const steps = [pendingStep('a')]
    emit(steps, { type: 'progress', id: 'missing', current: 1, total: 2 })
    emit(steps, { type: 'progress', id: 'a', current: 3, total: 10 })
    expect(stepById(steps, 'a')).toMatchObject({ current: 3, total: 10 })
    expect(steps).toHaveLength(1)
  })

  it('detail sets the text of the matching step', () => {
    const steps = [pendingStep('a')]
    emit(steps, { type: 'detail', id: 'a', text: 'file.jar' })
    expect(stepById(steps, 'a').detail).toBe('file.jar')
  })

  it('finished marks the step done with the skipped flag and clears detail', () => {
    const steps = [pendingStep('a')]
    emit(steps, { type: 'detail', id: 'a', text: 'leftover' })
    emit(steps, { type: 'finished', id: 'a', skipped: true })
    expect(stepById(steps, 'a')).toMatchObject({ status: 'done', skipped: true, detail: '' })
  })

  it('failed marks the step error with the message and clears detail', () => {
    const steps = [pendingStep('a')]
    emit(steps, { type: 'detail', id: 'a', text: 'leftover' })
    emit(steps, { type: 'failed', id: 'a', message: 'boom' })
    expect(stepById(steps, 'a')).toMatchObject({ status: 'error', error: 'boom', detail: '' })
  })
})

describe('computeStepProgress', () => {
  it('returns 0 for an empty plan', () => {
    expect(computeStepProgress([])).toBe(0)
  })

  it('returns 0 while every step is pending', () => {
    expect(computeStepProgress([pendingStep('a'), pendingStep('b')])).toBe(0)
  })

  it('returns 100 when every step is finished', () => {
    expect(computeStepProgress([doneStep('a'), doneStep('b')])).toBe(100)
  })

  it('counts error steps as completed', () => {
    expect(computeStepProgress([errorStep('a'), doneStep('b')])).toBe(100)
  })

  it('adds the active step fraction to the completed share', () => {
    expect(computeStepProgress([doneStep('a'), activeStep('b', 5, 10)])).toBeCloseTo(75, 5)
  })

  it('counts an active step without totals as plain pending', () => {
    expect(computeStepProgress([doneStep('a'), activeStep('b', 0, 0)])).toBeCloseTo(50, 5)
  })

  it('clamps the active fraction at 1', () => {
    expect(computeStepProgress([doneStep('a'), activeStep('b', 5, 4)])).toBeCloseTo(100, 5)
  })

  it('adds the fractions of parallel active steps', () => {
    expect(computeStepProgress([activeStep('a', 1, 2), activeStep('b', 1, 4)])).toBeCloseTo(37.5, 5)
  })

  it('caps the summed parallel fractions at full progress', () => {
    expect(computeStepProgress([activeStep('a', 10, 10), activeStep('b', 9, 9)])).toBe(100)
  })

  it('mixes done steps with parallel active fractions', () => {
    expect(
      computeStepProgress([doneStep('a'), activeStep('b', 1, 4), activeStep('c', 1, 2)]),
    ).toBeCloseTo(58.3333, 3)
  })
})
