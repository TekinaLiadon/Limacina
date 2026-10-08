import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { bindSettingsDirtyTab, useSettingsDirtyStore } from '../settingsDirtyStore'
import { withSetup } from '@/test-support/withSetup'

describe('bindSettingsDirtyTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('tracks the tab dirtiness and clears it on scope dispose', async () => {
    const isDirty = ref<boolean>(false)
    const { unmount } = withSetup(() => {
      bindSettingsDirtyTab('launcher', isDirty)
    })
    const store = useSettingsDirtyStore()

    expect(store.dirtyTabs).toEqual([])

    isDirty.value = true
    await nextTick()
    expect(store.dirtyTabs).toEqual(['launcher'])

    isDirty.value = false
    await nextTick()
    expect(store.dirtyTabs).toEqual([])

    isDirty.value = true
    await nextTick()
    expect(store.dirtyTabs).toEqual(['launcher'])

    unmount()
    expect(store.dirtyTabs).toEqual([])
  })
})
