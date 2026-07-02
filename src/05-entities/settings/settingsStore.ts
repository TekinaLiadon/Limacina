import { defineStore } from 'pinia'

export interface SettingsState {
  animationsEnabled: boolean
}

const STORAGE_KEY = 'limacina-settings'

function loadFromStorage(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw)
    }
  } catch (e: unknown) {
    console.error(e)
  }
  return { animationsEnabled: true }
}

function saveToStorage(state: SettingsState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => loadFromStorage(),

  actions: {
    toggleAnimations(): void {
      this.animationsEnabled = !this.animationsEnabled
      saveToStorage({ animationsEnabled: this.animationsEnabled })
    },

    setAnimationsEnabled(value: boolean): void {
      this.animationsEnabled = value
      saveToStorage({ animationsEnabled: this.animationsEnabled })
    },
  },
})
