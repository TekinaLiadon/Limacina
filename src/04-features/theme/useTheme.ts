import { ref, watch } from 'vue'
import { useSettingsStore } from '@/05-entities'
import { saveTheme } from '@/06-shared/api'

const isSwitching = ref<boolean>(false)
const switchDirection = ref<'to-light' | 'to-dark'>('to-light')

export function useTheme(): {
  isSwitching: import('vue').Ref<boolean>
  switchDirection: import('vue').Ref<'to-light' | 'to-dark'>
} {
  const settingsStore = useSettingsStore()

  const applyTheme = (theme: string): void => {
    document.documentElement.setAttribute('data-theme', theme)
  }

  applyTheme(settingsStore.theme)

  watch(() => settingsStore.theme, (newTheme, oldTheme) => {
    if (!oldTheme) return

    const goingToLight = newTheme.endsWith('-light')
    switchDirection.value = goingToLight ? 'to-light' : 'to-dark'

    isSwitching.value = true

    saveTheme(newTheme).catch((e: unknown) => {
      console.error('Ошибка сохранения темы:', e)
    })

    setTimeout(() => {
      applyTheme(newTheme)
    }, 1500)

    setTimeout(() => {
      isSwitching.value = false
    }, 1500)
  })

  return { isSwitching, switchDirection }
}
