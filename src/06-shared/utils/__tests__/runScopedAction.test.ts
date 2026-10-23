import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { captureProjectScope } from '../captureProjectScope'
import { runScopedAction } from '../runScopedAction'
import { useAsyncRaceGuard } from '../useAsyncRaceGuard'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('../reportError', () => ({ reportError }))

describe('runScopedAction', () => {
  it('clears the error target, applies the result and returns its value while current', async () => {
    const errorTarget = ref('старая ошибка')
    const apply = vi.fn((): string => 'applied')

    const result = await runScopedAction({
      errorTarget,
      errorMessage: 'Не удалось выполнить действие',
      run: async (): Promise<number> => 7,
      apply,
    })

    expect(result).toBe('applied')
    expect(apply).toHaveBeenCalledWith(7)
    expect(errorTarget.value).toBe('')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('drops the result without applying it when the scope went stale', async () => {
    const errorTarget = ref('')
    const apply = vi.fn()

    const result = await runScopedAction({
      isCurrent: (): boolean => false,
      errorTarget,
      errorMessage: 'Не удалось выполнить действие',
      run: async (): Promise<number> => 7,
      apply,
    })

    expect(result).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
    expect(errorTarget.value).toBe('')
  })

  it('drops the result when a newer guarded action superseded it', async () => {
    const guard = useAsyncRaceGuard()
    const apply = vi.fn()

    const first = runScopedAction({
      guard,
      errorMessage: 'Не удалось выполнить действие',
      run: async (): Promise<number> => 1,
      apply,
    })
    const second = runScopedAction({
      guard,
      errorMessage: 'Не удалось выполнить действие',
      run: async (): Promise<number> => 2,
      apply,
    })

    expect(await first).toBeUndefined()
    expect(await second).toBeUndefined()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(2)
  })

  it('drops a result produced for a project that is no longer current', async () => {
    let currentProject = 'alpha'
    const scope = captureProjectScope((): string => currentProject)
    const apply = vi.fn()

    const pending = runScopedAction({
      scope,
      errorMessage: 'Не удалось выполнить действие',
      run: async (): Promise<number> => {
        currentProject = 'beta'
        return 7
      },
      apply,
    })

    expect(await pending).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
  })

  it('writes the failure message to the error target and reports it while current', async () => {
    const errorTarget = ref('')
    const failure = new Error('сетевой сбой')

    const result = await runScopedAction({
      errorTarget,
      errorMessage: 'Не удалось выполнить действие',
      run: (): Promise<number> => Promise.reject(failure),
    })

    expect(result).toBeUndefined()
    expect(errorTarget.value).toBe('сетевой сбой')
    expect(reportError).toHaveBeenCalledWith('Не удалось выполнить действие', failure)
  })

  it('keeps the error target untouched when the failure is stale', async () => {
    const errorTarget = ref('')

    await runScopedAction({
      isCurrent: (): boolean => false,
      errorTarget,
      errorMessage: 'Не удалось выполнить действие',
      run: (): Promise<number> => Promise.reject(new Error('старая ошибка')),
    })

    expect(errorTarget.value).toBe('')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('runs the error hook only for a current failure', async () => {
    const onError = vi.fn()

    await runScopedAction({
      errorMessage: 'Не удалось выполнить действие',
      onError,
      run: (): Promise<void> => Promise.reject(new Error('сбой')),
    })
    await runScopedAction({
      isCurrent: (): boolean => false,
      errorMessage: 'Не удалось выполнить действие',
      onError,
      run: (): Promise<void> => Promise.reject(new Error('сбой')),
    })

    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('sets the busy flag up front and clears it in the end while current', async () => {
    const busyFlag = ref(false)
    const seenBusy: boolean[] = []

    await runScopedAction({
      errorMessage: 'Не удалось выполнить действие',
      busyFlag,
      run: async (): Promise<void> => {
        seenBusy.push(busyFlag.value)
      },
    })

    expect(seenBusy).toEqual([true])
    expect(busyFlag.value).toBe(false)
  })

  it('keeps the busy flag raised when the response is stale', async () => {
    const busyFlag = ref(false)

    await runScopedAction({
      isCurrent: (): boolean => false,
      errorMessage: 'Не удалось выполнить действие',
      busyFlag,
      run: async (): Promise<void> => {},
    })

    expect(busyFlag.value).toBe(true)
  })

  it('runs the cleanup callback on success and on failure', async () => {
    const cleanup = vi.fn()

    await runScopedAction({
      errorMessage: 'Не удалось выполнить действие',
      cleanup,
      run: async (): Promise<void> => {},
    })
    await runScopedAction({
      errorMessage: 'Не удалось выполнить действие',
      cleanup,
      run: (): Promise<void> => Promise.reject(new Error('сбой')),
    })

    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('awaits an async apply and returns its value', async () => {
    const apply = vi.fn(async (): Promise<boolean> => true)

    const result = await runScopedAction({
      errorMessage: 'Не удалось выполнить действие',
      run: async (): Promise<void> => {},
      apply,
    })

    expect(result).toBe(true)
  })
})
