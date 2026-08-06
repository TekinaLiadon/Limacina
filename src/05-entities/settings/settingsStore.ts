import { defineStore } from 'pinia'

export interface SettingsState {
  animationsEnabled: boolean
  theme: string
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
  return { animationsEnabled: true, theme: 'test-dark' }
}

function saveToStorage(state: SettingsState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => loadFromStorage(),

  getters: {
    isDark(): boolean {
      return !this.theme.endsWith('-light')
    },
  },

  actions: {
    toggleAnimations(): void {
      this.animationsEnabled = !this.animationsEnabled
      saveToStorage({ animationsEnabled: this.animationsEnabled, theme: this.theme })
    },

    setAnimationsEnabled(value: boolean): void {
      this.animationsEnabled = value
      saveToStorage({ animationsEnabled: this.animationsEnabled, theme: this.theme })
    },

    setTheme(theme: string): void {
      this.theme = theme
      saveToStorage({ animationsEnabled: this.animationsEnabled, theme: this.theme })
    },

    toggleDarkLight(): void {
      if (this.theme.endsWith('-light')) {
        this.theme = this.theme.replace('-light', '-dark')
      } else {
        this.theme = this.theme.replace('-dark', '-light')
      }
      saveToStorage({ animationsEnabled: this.animationsEnabled, theme: this.theme })
    },
  },
})
