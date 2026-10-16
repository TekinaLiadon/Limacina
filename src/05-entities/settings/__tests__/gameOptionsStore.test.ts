import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameOptionsStore } from '../gameOptionsStore'
import type { GameOptions } from '../../core/types'

const makeOptions = (overrides: Partial<GameOptions> = {}): GameOptions =>
  ({ fov: 70, resourcePacks: [], ...overrides }) as unknown as GameOptions

describe('useGameOptionsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps pending settings for the project they were saved in', () => {
    const store = useGameOptionsStore()
    store.setPending('proj', makeOptions({ fov: 110 }))

    expect(store.pendingFor('proj')?.fov).toBe(110)
    expect(store.pendingFor('other')).toBeNull()
  })

  it('drops pending settings of another project when a new project saves', () => {
    const store = useGameOptionsStore()
    store.setPending('proj', makeOptions({ fov: 110 }))
    store.setPending('other', makeOptions({ fov: 60 }))

    expect(store.pendingFor('proj')).toBeNull()
    expect(store.pendingFor('other')?.fov).toBe(60)
  })

  it('clears pending settings only for the project that was installed', () => {
    const store = useGameOptionsStore()
    store.setPending('proj', makeOptions({ fov: 110 }))

    store.clearPending('other')
    expect(store.pendingFor('proj')).not.toBeNull()

    store.clearPending('proj')
    expect(store.pendingFor('proj')).toBeNull()
  })

  it('stores a copy so later form edits do not leak into the pending settings', () => {
    const store = useGameOptionsStore()
    const form = makeOptions({ fov: 110, resourcePacks: ['faithful.zip'] })

    store.setPending('proj', form)
    form.fov = 30
    form.resourcePacks.push('extra.zip')

    expect(store.pendingFor('proj')?.fov).toBe(110)
    expect(store.pendingFor('proj')?.resourcePacks).toEqual(['faithful.zip'])
  })
})
