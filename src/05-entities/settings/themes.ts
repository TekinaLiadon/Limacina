import type { ThemeFamily, ThemeMode } from './types'

export const THEME_FAMILIES: ThemeFamily[] = [
  {
    id: 'default',
    title: 'Стандартная',
    description: 'Тёмно-синий фон, серебристо-голубой текст, фиолетовый акцент',
    preview: {
      dark: { bg: '#05060f', surface: '#2f343e', accent: '#663af3' },
      light: { bg: '#f4f6fb', surface: '#e3e8f2', accent: '#5b2fe0' },
    },
  },
  {
    id: 'test',
    title: 'Ночная синь',
    description: 'Тёмно-синий фон, светло-серый текст, васильковый акцент',
    preview: {
      dark: { bg: '#1a1d2e', surface: '#16213e', accent: '#6c7fd8' },
      light: { bg: '#f0f2f8', surface: '#e8ecf4', accent: '#5a6a9a' },
    },
  },
  {
    id: 'lime',
    title: 'Лайм',
    description: 'Чёрный фон, светло-зелёный текст, лаймовый акцент',
    preview: {
      dark: { bg: '#000000', surface: '#181818', accent: '#7fee64' },
      light: { bg: '#eef7ec', surface: '#def0dd', accent: '#2f7d1f' },
    },
  },
  {
    id: 'spark',
    title: 'Искра',
    description: 'Тёмно-фиолетовый фон, сиреневый текст, фиолетовый и оранжевый акценты',
    preview: {
      dark: { bg: '#0e0918', surface: '#1a1624', accent: '#fd8925' },
      light: { bg: '#f5f3f9', surface: '#ebe8f2', accent: '#fd8925' },
    },
  },
  {
    id: 'monologue',
    title: 'Монолог',
    description: 'Чёрный фон, белый и серый текст, циановый акцент',
    preview: {
      dark: { bg: '#000000', surface: '#191919', accent: '#19d0e8' },
      light: { bg: '#f7f9fa', surface: '#e9eef0', accent: '#0d8fa8' },
    },
  },
]

const DEFAULT_THEME_FAMILY: string = 'default'
const DEFAULT_THEME_MODE: ThemeMode = 'dark'
export const DEFAULT_THEME: string = `${DEFAULT_THEME_FAMILY}-${DEFAULT_THEME_MODE}`

export function buildThemeId(family: string, mode: ThemeMode): string {
  return `${family}-${mode}`
}

export function parseThemeId(theme: string): { family: string; mode: ThemeMode } {
  const mode: ThemeMode = theme.endsWith('-light') ? 'light' : 'dark'
  const family: string = theme.replace(/-(light|dark)$/, '')
  return { family, mode }
}

function isKnownTheme(theme: string): boolean {
  const { family, mode } = parseThemeId(theme)
  if (!THEME_FAMILIES.some((f) => f.id === family)) return false
  return buildThemeId(family, mode) === theme
}

export function normalizeTheme(theme: string | null | undefined): string {
  if (!theme) return DEFAULT_THEME
  return isKnownTheme(theme) ? theme : DEFAULT_THEME
}
