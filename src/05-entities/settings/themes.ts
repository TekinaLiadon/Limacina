import type { ThemeFamily, ThemeMode } from './types'

/**
 * Реестр тем. Каждое семейство темы обязано иметь два варианта:
 * `{id}-dark` и `{id}-light` — соответствующие файлы лежат
 * в `01-app/assets/themes/` и подключены в `main.scss`.
 */
export const THEME_FAMILIES: ThemeFamily[] = [
  {
    id: 'default',
    title: 'Default',
    description: 'Морозное стекло в полночь: near-black холст, стеклянные поверхности, фиолетовый акцент',
    preview: {
      dark: { bg: '#05060f', surface: '#2f343e', accent: '#663af3' },
      light: { bg: '#f4f6fb', surface: '#e3e8f2', accent: '#5b2fe0' },
    },
  },
  {
    id: 'test',
    title: 'Ночная синь',
    description: 'Базовая тема лаунчера: тёмно-синий градиент и приглушённый индиго-акцент',
    preview: {
      dark: { bg: '#1a1d2e', surface: '#16213e', accent: '#6c7fd8' },
      light: { bg: '#f0f2f8', surface: '#e8ecf4', accent: '#5a6a9a' },
    },
  },
  {
    id: 'lime',
    title: 'Лайм',
    description: 'Фосфорный терминал: чёрный холст, плоские поверхности и лаймовый индикатор',
    preview: {
      dark: { bg: '#000000', surface: '#181818', accent: '#7fee64' },
      light: { bg: '#eef7ec', surface: '#def0dd', accent: '#2f7d1f' },
    },
  },
  {
    id: 'spark',
    title: 'Искра',
    description: 'Ночной воркфлоу: фиолетово-чёрные панели, огненная кнопка и электрический акцент',
    preview: {
      dark: { bg: '#0e0918', surface: '#1a1624', accent: '#fd8925' },
      light: { bg: '#f5f3f9', surface: '#ebe8f2', accent: '#fd8925' },
    },
  },
]

export const DEFAULT_THEME_FAMILY: string = 'default'
export const DEFAULT_THEME_MODE: ThemeMode = 'dark'
export const DEFAULT_THEME: string = `${DEFAULT_THEME_FAMILY}-${DEFAULT_THEME_MODE}`

export function buildThemeId(family: string, mode: ThemeMode): string {
  return `${family}-${mode}`
}

export function parseThemeId(theme: string): { family: string; mode: ThemeMode } {
  const mode: ThemeMode = theme.endsWith('-light') ? 'light' : 'dark'
  const family: string = theme.replace(/-(light|dark)$/, '')
  return { family, mode }
}

export function isKnownTheme(theme: string): boolean {
  const { family, mode } = parseThemeId(theme)
  if (!THEME_FAMILIES.some((f) => f.id === family)) return false
  return buildThemeId(family, mode) === theme
}

export function normalizeTheme(theme: string | null | undefined): string {
  if (!theme) return DEFAULT_THEME
  return isKnownTheme(theme) ? theme : DEFAULT_THEME
}
