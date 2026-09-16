import { ref, watch, type Ref } from 'vue'
import { useSettingsStore, parseThemeId } from '@/05-entities'
import { saveTheme, setWindowBackgroundColor, cssDurationMs, reportError } from '@/06-shared'

const SWITCH_DURATION_MS = cssDurationMs('--switch-duration', 1500)

const isSwitching = ref<boolean>(false)
const switchDirection = ref<'to-light' | 'to-dark'>('to-light')

function applyWindowBackground(theme: string): void {
  const probe = document.createElement('div')
  probe.setAttribute('data-theme', theme)
  document.documentElement.appendChild(probe)
  const color = getComputedStyle(probe).getPropertyValue('--html-bg').trim()
  probe.remove()
  if (!color) return
  setWindowBackgroundColor(color).catch((e: unknown): void => {
    reportError('Не удалось применить цвет окна', e)
  })
}

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
  applyWindowBackground(settingsStore.theme)

  let switchTimerId: ReturnType<typeof setTimeout> | null = null

  watch(() => settingsStore.theme, (newTheme: string, oldTheme: string | undefined): void => {
    if (!oldTheme || newTheme === oldTheme) return

    saveTheme(newTheme).catch((e: unknown) => {
      reportError('Ошибка сохранения темы', e)
    })

    const newMode = parseThemeId(newTheme).mode
    const oldMode = parseThemeId(oldTheme).mode
    const modeChanged: boolean = newMode !== oldMode

    if (!modeChanged || !settingsStore.animationsEnabled) {
      applyTheme(newTheme)
      applyWindowBackground(newTheme)
      return
    }

    switchDirection.value = newMode === 'light' ? 'to-light' : 'to-dark'
    isSwitching.value = true
    applyWindowBackground(newTheme)

    if (switchTimerId !== null) clearTimeout(switchTimerId)
    switchTimerId = setTimeout(() => {
      applyTheme(newTheme)
      isSwitching.value = false
      switchTimerId = null
    }, SWITCH_DURATION_MS)
  })

  return { isSwitching, switchDirection }
}
