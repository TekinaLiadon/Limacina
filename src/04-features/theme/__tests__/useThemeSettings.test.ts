import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore, THEME_FAMILIES } from '@/05-entities'
import { useThemeSwitchState } from '../useTheme'
import { useThemeSettings } from '../useThemeSettings'

describe('useThemeSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    settings.setTheme('default-dark')
    settings.setAnimationsEnabled(true)
    const { isSwitching } = useThemeSwitchState()
    isSwitching.value = false
  })

  it('exposes the theme families and current state', () => {
    const settings = useThemeSettings()

    expect(settings.families).toBe(THEME_FAMILIES)
    expect(settings.currentTheme.value).toBe('default-dark')
    expect(settings.currentFamily.value).toBe('default')
    expect(settings.currentMode.value).toBe('dark')
    expect(settings.isSwitchDisabled.value).toBe(false)
  })

  it('switches the family and keeps the mode', () => {
    const settings = useThemeSettings()

    settings.selectFamily('lime')

    expect(useSettingsStore().theme).toBe('lime-dark')
    expect(settings.currentFamily.value).toBe('lime')
  })

  it('switches the mode and keeps the family', () => {
    const settings = useThemeSettings()

    settings.selectMode('light')

    expect(useSettingsStore().theme).toBe('default-light')
    expect(settings.currentMode.value).toBe('light')
  })

  it('ignores a selection of the already active family or mode', () => {
    const settings = useThemeSettings()

    settings.selectFamily('default')
    settings.selectMode('dark')

    expect(useSettingsStore().theme).toBe('default-dark')
  })

  it('previews a family for the current mode', () => {
    const settings = useThemeSettings()
    const lime = THEME_FAMILIES.find((family) => family.id === 'lime')
    expect(lime).toBeDefined()
    if (!lime) return

    const preview = settings.previewOf(lime)

    expect(preview).toBe(lime.preview.dark)
  })

  it('disables the mode switch while the switch animation is running', () => {
    const { isSwitching } = useThemeSwitchState()
    const settings = useThemeSettings()

    isSwitching.value = true
    expect(settings.isSwitchDisabled.value).toBe(true)

    isSwitching.value = false
    expect(settings.isSwitchDisabled.value).toBe(false)
  })
})
