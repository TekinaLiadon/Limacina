import { computed, type ComputedRef } from 'vue'
import { useSettingsStore, THEME_FAMILIES, type ThemeFamily, type ThemeMode, type ThemePreview } from '@/05-entities'
import { useThemeSwitchState } from './useTheme'

export function useThemeSettings(): {
  families: ThemeFamily[]
  currentTheme: ComputedRef<string>
  currentFamily: ComputedRef<string>
  currentMode: ComputedRef<ThemeMode>
  isSwitchDisabled: ComputedRef<boolean>
  previewOf: (family: ThemeFamily) => ThemePreview
  selectFamily: (familyId: string) => void
  selectMode: (mode: ThemeMode) => void
} {
  const settingsStore = useSettingsStore()
  const { isSwitching } = useThemeSwitchState()

  const currentTheme = computed((): string => settingsStore.theme)
  const currentFamily = computed((): string => settingsStore.themeFamily)
  const currentMode = computed((): ThemeMode => settingsStore.themeMode)

  const isSwitchDisabled = computed((): boolean => isSwitching.value)

  const previewOf = (family: ThemeFamily): ThemePreview => family.preview[currentMode.value]

  const selectFamily = (familyId: string): void => {
    if (familyId === currentFamily.value) return
    settingsStore.setTheme(familyId, currentMode.value)
  }

  const selectMode = (mode: ThemeMode): void => {
    if (mode === currentMode.value) return
    settingsStore.setTheme(currentFamily.value, mode)
  }

  return {
    families: THEME_FAMILIES,
    currentTheme,
    currentFamily,
    currentMode,
    isSwitchDisabled,
    previewOf,
    selectFamily,
    selectMode,
  }
}
