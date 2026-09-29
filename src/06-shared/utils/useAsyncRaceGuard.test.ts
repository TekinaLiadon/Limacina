import { describe, expect, it } from 'vitest'
import { useAsyncRaceGuard } from './useAsyncRaceGuard'

describe('useAsyncRaceGuard', () => {
  it('tracks the latest generation', () => {
    const guard = useAsyncRaceGuard()

    const first = guard.next()
    expect(guard.isCurrent(first)).toBe(true)

    const second = guard.next()
    expect(second).toBe(first + 1)
    expect(guard.isCurrent(second)).toBe(true)
    expect(guard.isCurrent(first)).toBe(false)
  })

  it('invalidates in-flight generations on cancel', () => {
    const guard = useAsyncRaceGuard()

    const generation = guard.next()
    guard.cancel()

    expect(guard.isCurrent(generation)).toBe(false)

    const fresh = guard.next()
    expect(guard.isCurrent(fresh)).toBe(true)
  })

  it('keeps guards independent per instance', () => {
    const a = useAsyncRaceGuard()
    const b = useAsyncRaceGuard()

    const aGeneration = a.next()
    expect(b.isCurrent(aGeneration)).toBe(false)
  })
})
