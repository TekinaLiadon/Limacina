import { defineStore } from 'pinia'

export type SettingsDirtyTab = 'launcher' | 'game'

interface SettingsDirtyState {
  dirtyTabs: SettingsDirtyTab[]
}

export const useSettingsDirtyStore = defineStore('settingsDirty', {
  state: (): SettingsDirtyState => ({
    dirtyTabs: [],
  }),

  getters: {
    hasDirtyTabs: (state): boolean => state.dirtyTabs.length > 0,
  },

  actions: {
    setTabDirty(tab: SettingsDirtyTab, isDirty: boolean): void {
      const isTracked = this.dirtyTabs.includes(tab)
      if (isDirty === isTracked) return
      if (isDirty) {
        this.dirtyTabs.push(tab)
        return
      }
      this.dirtyTabs = this.dirtyTabs.filter((item) => item !== tab)
    },
  },
})
