import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, watch } from 'vue'
import { createSingletonListeners } from '../createSingletonListeners'
import { withSetup } from '@/test-support/withSetup'

describe('createSingletonListeners', () => {
  it('runs registration once and keeps tracked stops until stop', async () => {
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const register = vi.fn(async (track: (stop: () => void) => void): Promise<void> => {
      track(firstStop)
      track(secondStop)
    })
    const listeners = createSingletonListeners()

    await listeners.start(register)

    expect(register).toHaveBeenCalledTimes(1)
    expect(listeners.isStarted()).toBe(true)
    expect(firstStop).not.toHaveBeenCalled()
    expect(secondStop).not.toHaveBeenCalled()

    listeners.stop()

    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(secondStop).toHaveBeenCalledTimes(1)
    expect(listeners.isStarted()).toBe(false)
  })

  it('cleans up already tracked stops when registration fails and rethrows', async () => {
    const firstStop = vi.fn()
    const failure = new Error('регистрация отвалилась')
    const listeners = createSingletonListeners()

    await expect(listeners.start(async (track: (stop: () => void) => void): Promise<void> => {
      track(firstStop)
      throw failure
    })).rejects.toBe(failure)

    expect(firstStop).toHaveBeenCalledTimes(1)
    expect(listeners.isStarted()).toBe(false)
  })

  it('does not duplicate registration when start is called again after success', async () => {
    const register = vi.fn()
    const listeners = createSingletonListeners()

    await listeners.start(register)
    await listeners.start(register)

    expect(register).toHaveBeenCalledTimes(1)
    expect(listeners.isStarted()).toBe(true)
  })

  it('shares the in-flight start between concurrent callers', async () => {
    let releaseRegistration!: () => void
    const register = vi.fn(async (): Promise<void> => {
      await new Promise<void>((resolve): void => {
        releaseRegistration = resolve
      })
    })
    const listeners = createSingletonListeners()

    const firstCall = listeners.start(register)
    const secondCall = listeners.start(register)
    releaseRegistration()
    await Promise.all([firstCall, secondCall])

    expect(register).toHaveBeenCalledTimes(1)
    expect(listeners.isStarted()).toBe(true)
  })

  it('allows restart after stop and retry after failure', async () => {
    const register = vi.fn()
    const listeners = createSingletonListeners()

    await listeners.start(register)
    listeners.stop()
    await expect(listeners.start((): Promise<void> => Promise.reject(new Error('сбой')))).rejects.toThrow('сбой')
    await listeners.start(register)

    expect(register).toHaveBeenCalledTimes(2)
    expect(listeners.isStarted()).toBe(true)
  })

  it('stops watches created during registration', async () => {
    const listeners = createSingletonListeners()
    const source = ref(0)
    const seen: number[] = []

    await listeners.start((track: (stop: () => void) => void): void => {
      track(watch(source, (value: number): void => {
        seen.push(value)
      }))
    })

    source.value = 1
    await nextTick()
    expect(seen).toEqual([1])

    listeners.stop()

    source.value = 2
    await nextTick()
    expect(seen).toEqual([1])
  })

  it('keeps watches created during registration alive after the calling component unmounts', async () => {
    const listeners = createSingletonListeners()
    const source = ref(0)
    const seen: number[] = []

    const host = withSetup((): void => {
      void listeners.start((track: (stop: () => void) => void): void => {
        track(watch(source, (value: number): void => {
          seen.push(value)
        }))
      })
    })

    source.value = 1
    await nextTick()
    expect(seen).toEqual([1])

    host.unmount()

    source.value = 2
    await nextTick()
    expect(seen).toEqual([1, 2])

    listeners.stop()

    source.value = 3
    await nextTick()
    expect(seen).toEqual([1, 2])
  })
})
