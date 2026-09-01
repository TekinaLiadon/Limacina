import { ref, watch, type Ref } from 'vue'
import { useSettingsStore, parseThemeId } from '@/05-entities'
import { saveTheme } from '@/06-shared/api'

const SWITCH_DURATION = 1500

const isSwitching = ref<boolean>(false)
const switchDirection = ref<'to-light' | 'to-dark'>('to-light')

export function useThemeSwitchState(): {
  isSwitching: Ref<boolean>
  switchDirection: Ref<'to-light' | 'to-dark'>
} {
  return { isSwitching, switchDirection }
}

export function useTheme(): {
  isSwitching: Ref<boolean>
  switchDirection: Ref<'to-light' | 'to-dark'>
} {
  const settingsStore = useSettingsStore()

  const applyTheme = (theme: string): void => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  applyTheme(settingsStore.theme)

  watch(() => settingsStore.theme, (newTheme: string, oldTheme: string | undefined): void => {
    if (!oldTheme || newTheme === oldTheme) return

    saveTheme(newTheme).catch((e: unknown) => {
      console.error('Ошибка сохранения темы:', e)
    })

    const newMode = parseThemeId(newTheme).mode
    const oldMode = parseThemeId(oldTheme).mode
    const modeChanged: boolean = newMode !== oldMode

    if (!modeChanged || !settingsStore.animationsEnabled) {
      applyTheme(newTheme)
      return
    }

    switchDirection.value = newMode === 'light' ? 'to-light' : 'to-dark'
    isSwitching.value = true

    setTimeout(() => {
      applyTheme(newTheme)
      isSwitching.value = false
    }, SWITCH_DURATION)
  })

  return { isSwitching, switchDirection }
}
