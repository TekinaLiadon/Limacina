import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settingsStore'

const THEME_KEY = 'limacina-theme'
const ANIMATIONS_KEY = 'limacina-animations'
const LEGACY_KEY = 'limacina-settings'

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.animations
    setActivePinia(createPinia())
  })

  it('defaults to the standard dark theme and enabled animations', () => {
    const store = useSettingsStore()
    expect(store.theme).toBe('default-dark')
    expect(store.animationsEnabled).toBe(true)
    expect(store.isDark).toBe(true)
    expect(store.themeMode).toBe('dark')
    expect(store.themeFamily).toBe('default')
  })

  it('removes the legacy storage key on init', () => {
    localStorage.setItem(LEGACY_KEY, '{}')
    useSettingsStore()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('restores a cached theme on init', () => {
    localStorage.setItem(THEME_KEY, 'lime-light')
    const store = useSettingsStore()
    expect(store.theme).toBe('lime-light')
    expect(store.isDark).toBe(false)
    expect(store.themeFamily).toBe('lime')
    expect(store.themeMode).toBe('light')
  })

  it('falls back to the default theme for an unknown cached value', () => {
    localStorage.setItem(THEME_KEY, 'bogus-dark')
    const store = useSettingsStore()
    expect(store.theme).toBe('default-dark')
  })

  it('restores the cached animations preference on init', () => {
    localStorage.setItem(ANIMATIONS_KEY, 'off')
    const store = useSettingsStore()
    expect(store.animationsEnabled).toBe(false)
    expect(document.documentElement.dataset.animations).toBe('off')
  })

  it('keeps animations enabled when the cache is missing or mangled', () => {
    localStorage.setItem(ANIMATIONS_KEY, 'whatever')
    expect(useSettingsStore().animationsEnabled).toBe(true)
    localStorage.removeItem(ANIMATIONS_KEY)
    setActivePinia(createPinia())
    expect(useSettingsStore().animationsEnabled).toBe(true)
  })

  it('persists theme changes and applies them to the state', () => {
    const store = useSettingsStore()
    store.setTheme('spark-light')
    expect(store.theme).toBe('spark-light')
    expect(localStorage.getItem(THEME_KEY)).toBe('spark-light')
    expect(store.isDark).toBe(false)
  })

  it('normalizes unknown themes to the default on set', () => {
    const store = useSettingsStore()
    store.setTheme('nope-dark')
    expect(store.theme).toBe('default-dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('default-dark')
  })

  it('changes family and mode independently', () => {
    const store = useSettingsStore()
    store.setThemeFamily('monologue')
    expect(store.theme).toBe('monologue-dark')
    store.setThemeMode('light')
    expect(store.theme).toBe('monologue-light')
    expect(store.themeFamily).toBe('monologue')
    expect(store.themeMode).toBe('light')
  })

  it('toggles animations and persists the preference', () => {
    const store = useSettingsStore()
    store.toggleAnimations()
    expect(store.animationsEnabled).toBe(false)
    expect(localStorage.getItem(ANIMATIONS_KEY)).toBe('off')
    expect(document.documentElement.dataset.animations).toBe('off')
    store.toggleAnimations()
    expect(store.animationsEnabled).toBe(true)
    expect(localStorage.getItem(ANIMATIONS_KEY)).toBe('on')
    expect(document.documentElement.dataset.animations).toBe('on')
  })

  it('applies an explicit animations value', () => {
    const store = useSettingsStore()
    store.setAnimationsEnabled(false)
    expect(store.animationsEnabled).toBe(false)
    store.setAnimationsEnabled(true)
    expect(document.documentElement.dataset.animations).toBe('on')
  })
})
