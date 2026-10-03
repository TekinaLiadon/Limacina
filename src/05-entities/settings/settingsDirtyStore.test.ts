import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsDirtyStore } from './settingsDirtyStore'

describe('useSettingsDirtyStore', () => {
  it('starts with no dirty tabs', () => {
    setActivePinia(createPinia())
    expect(useSettingsDirtyStore().dirtyTabs).toEqual([])
    expect(useSettingsDirtyStore().hasDirtyTabs).toBe(false)
  })

  it('tracks tabs becoming dirty and clean again', () => {
    setActivePinia(createPinia())
    const store = useSettingsDirtyStore()

    store.setTabDirty('launcher', true)
    expect(store.dirtyTabs).toEqual(['launcher'])
    expect(store.hasDirtyTabs).toBe(true)

    store.setTabDirty('game', true)
    expect(store.dirtyTabs).toEqual(['launcher', 'game'])

    store.setTabDirty('launcher', false)
    expect(store.dirtyTabs).toEqual(['game'])

    store.setTabDirty('game', false)
    expect(store.hasDirtyTabs).toBe(false)
  })

  it('ignores a repeated dirty state for the same tab', () => {
    setActivePinia(createPinia())
    const store = useSettingsDirtyStore()

    store.setTabDirty('game', true)
    store.setTabDirty('game', true)
    store.setTabDirty('launcher', false)

    expect(store.dirtyTabs).toEqual(['game'])
  })
})
