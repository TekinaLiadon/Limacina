import { defineStore } from 'pinia'
import type { ThemeMode } from './types'
import { buildThemeId, normalizeTheme, parseThemeId } from './themes'

export interface SettingsState {
  animationsEnabled: boolean
  theme: string
}

const THEME_CACHE_KEY = 'limacina-theme'
const LEGACY_STORAGE_KEY = 'limacina-settings'

function loadCachedTheme(): string {
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  return normalizeTheme(localStorage.getItem(THEME_CACHE_KEY))
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    animationsEnabled: true,
    theme: loadCachedTheme(),
  }),

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
    toggleAnimations(): void {
      this.animationsEnabled = !this.animationsEnabled
    },

    setAnimationsEnabled(value: boolean): void {
      this.animationsEnabled = value
    },

    setTheme(theme: string): void {
      this.theme = normalizeTheme(theme)
      localStorage.setItem(THEME_CACHE_KEY, this.theme)
    },

    setThemeFamily(family: string): void {
      this.setTheme(buildThemeId(family, this.themeMode))
    },

    setThemeMode(mode: ThemeMode): void {
      this.setTheme(buildThemeId(this.themeFamily, mode))
    },
  },
})
