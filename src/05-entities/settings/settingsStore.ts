import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ThemeMode } from './types'
import { buildThemeId, normalizeTheme, parseThemeId } from './themes'

const THEME_CACHE_KEY = 'limacina-theme'
const ANIMATIONS_CACHE_KEY = 'limacina-animations'

function loadCachedTheme(): string {
  return normalizeTheme(localStorage.getItem(THEME_CACHE_KEY))
}

function applyAnimationsPreference(value: boolean): void {
  document.documentElement.dataset.animations = value ? 'on' : 'off'
}

function loadCachedAnimationsEnabled(): boolean {
  const cached = localStorage.getItem(ANIMATIONS_CACHE_KEY)
  if (cached === 'on' || cached === 'off') {
    applyAnimationsPreference(cached === 'on')
    return cached === 'on'
  }
  return true
}

export const useSettingsStore = defineStore('settings', () => {
  const animationsEnabled = ref<boolean>(loadCachedAnimationsEnabled())
  const theme = ref<string>(loadCachedTheme())
  const lastHydratedTheme = ref<string | null>(null)

  const themeMode = computed<ThemeMode>(() => parseThemeId(theme.value).mode)
  const themeFamily = computed<string>(() => parseThemeId(theme.value).family)
  const isDark = computed<boolean>(() => themeMode.value === 'dark')

  function toggleAnimations(): void {
    setAnimationsEnabled(!animationsEnabled.value)
  }

  function setAnimationsEnabled(value: boolean): void {
    animationsEnabled.value = value
    applyAnimationsPreference(value)
    localStorage.setItem(ANIMATIONS_CACHE_KEY, value ? 'on' : 'off')
  }

  function setTheme(nextTheme: string): void {
    theme.value = normalizeTheme(nextTheme)
    localStorage.setItem(THEME_CACHE_KEY, theme.value)
  }

  function clearHydratedTheme(): void {
    lastHydratedTheme.value = null
  }

  function setThemeFamily(family: string): void {
    clearHydratedTheme()
    setTheme(buildThemeId(family, themeMode.value))
  }

  function setThemeMode(mode: ThemeMode): void {
    clearHydratedTheme()
    setTheme(buildThemeId(themeFamily.value, mode))
  }

  function markThemeHydration(hydratedTheme: string): void {
    const normalized = normalizeTheme(hydratedTheme)
    lastHydratedTheme.value = normalized === theme.value ? null : normalized
  }

  return {
    animationsEnabled,
    theme,
    lastHydratedTheme,
    themeMode,
    themeFamily,
    isDark,
    toggleAnimations,
    setAnimationsEnabled,
    setTheme,
    setThemeFamily,
    setThemeMode,
    markThemeHydration,
    clearHydratedTheme,
  }
})
