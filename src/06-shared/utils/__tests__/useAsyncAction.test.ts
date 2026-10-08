import { describe, expect, it, vi } from 'vitest'
import { useAsyncAction } from '../useAsyncAction'

describe('useAsyncAction', () => {
  it('runs the action and toggles the loading flag around it', async () => {
    let releaseAction: () => void = () => {}
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseAction = resolve
        }),
    )
    const onError = vi.fn()
    const action0 = useAsyncAction(onError)

    expect(action0.isLoading.value).toBe(false)
    const pending = action0.run(action)
    expect(action0.isLoading.value).toBe(true)

    releaseAction()
    await pending

    expect(action).toHaveBeenCalledTimes(1)
    expect(action0.isLoading.value).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('passes the error to the error handler and resets the flag', async () => {
    const failure = new Error('save failed')
    const onError = vi.fn()
    const action0 = useAsyncAction(onError)

    await action0.run(async () => {
      throw failure
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(action0.isLoading.value).toBe(false)
  })

  it('awaits an async error handler before resetting the flag', async () => {
    let releaseHandler: () => void = () => {}
    const onError = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve
        }),
    )
    const action0 = useAsyncAction(onError)

    const pending = action0.run(async () => {
      throw new Error('boom')
    })
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(action0.isLoading.value).toBe(true)

    releaseHandler()
    await pending

    expect(action0.isLoading.value).toBe(false)
  })

  it('ignores a re-entrant run while the action is pending', async () => {
    let releaseAction: () => void = () => {}
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseAction = resolve
        }),
    )
    const onError = vi.fn()
    const action0 = useAsyncAction(onError)

    const first = action0.run(action)
    await action0.run(async () => {
      throw new Error('must not run')
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()

    releaseAction()
    await first

    expect(action0.isLoading.value).toBe(false)
    await action0.run(async () => {})
    expect(action0.isLoading.value).toBe(false)
  })

  it('shares an external loading flag between actions', async () => {
    const { ref } = await import('vue')
    const shared = ref<boolean>(false)
    const first = useAsyncAction(vi.fn(), shared)
    const second = useAsyncAction(vi.fn(), shared)

    const pending = first.run(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        }),
    )
    expect(shared.value).toBe(true)
    await second.run(async () => {
      throw new Error('must not run')
    })
    await pending

    expect(shared.value).toBe(false)
  })
})
