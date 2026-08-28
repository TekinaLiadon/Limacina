import { defineStore } from 'pinia'
import type { ThemeMode } from './types'
import { DEFAULT_THEME, buildThemeId, normalizeTheme, parseThemeId } from './themes'

export interface SettingsState {
  animationsEnabled: boolean
  theme: string
}

const STORAGE_KEY = 'limacina-settings'

function loadFromStorage(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: Partial<SettingsState> = JSON.parse(raw)
      return {
        animationsEnabled: parsed.animationsEnabled ?? true,
        theme: normalizeTheme(parsed.theme),
      }
    }
  } catch (e: unknown) {
    console.error(e)
  }
  return { animationsEnabled: true, theme: DEFAULT_THEME }
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

    themeMode(): ThemeMode {
      return parseThemeId(this.theme).mode
    },

    themeFamily(): string {
      return parseThemeId(this.theme).family
    },
  },

  actions: {
    persist(): void {
      saveToStorage({ animationsEnabled: this.animationsEnabled, theme: this.theme })
    },

    toggleAnimations(): void {
      this.animationsEnabled = !this.animationsEnabled
      this.persist()
    },

    setAnimationsEnabled(value: boolean): void {
      this.animationsEnabled = value
      this.persist()
    },

    setTheme(theme: string): void {
      this.theme = normalizeTheme(theme)
      this.persist()
    },

    setThemeFamily(family: string): void {
      this.setTheme(buildThemeId(family, this.themeMode))
    },

    setThemeMode(mode: ThemeMode): void {
      this.setTheme(buildThemeId(this.themeFamily, mode))
    },
  },
})
