import { computed, onScopeDispose, ref, watchEffect, type ComputedRef, type Ref } from 'vue'
import { defineStore } from 'pinia'

export type SettingsDirtyTab = 'launcher' | 'game'

export const useSettingsDirtyStore = defineStore('settingsDirty', () => {
  const dirtyTabs = ref<SettingsDirtyTab[]>([])
  const hasDirtyTabs = computed<boolean>(() => dirtyTabs.value.length > 0)

  function setTabDirty(tab: SettingsDirtyTab, isDirty: boolean): void {
    const isTracked = dirtyTabs.value.includes(tab)
    if (isDirty === isTracked) return
    if (isDirty) {
      dirtyTabs.value.push(tab)
      return
    }
    dirtyTabs.value = dirtyTabs.value.filter((item) => item !== tab)
  }

  return { dirtyTabs, hasDirtyTabs, setTabDirty }
})

export function bindSettingsDirtyTab(
  tab: SettingsDirtyTab,
  isDirty: Ref<boolean> | ComputedRef<boolean>,
): void {
  const store = useSettingsDirtyStore()
  watchEffect((): void => {
    store.setTabDirty(tab, isDirty.value)
  })
  onScopeDispose((): void => {
    store.setTabDirty(tab, false)
  })
}
