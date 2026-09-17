import type { ThemeFamily, ThemeMode } from './types'

export const THEME_FAMILIES: ThemeFamily[] = [
  {
    id: 'default',
    title: 'Стандартная',
    description: 'Тёмно-синий фон, серебристо-голубой текст, фиолетовый акцент',
    preview: {
      dark: { bg: '#05060f', surface: '#10121d', accent: '#663af3' },
      light: { bg: '#f4f6fb', surface: '#f5f5f6', accent: '#5b2fe0' },
    },
  },
  {
    id: 'night',
    title: 'Ночная синь',
    description: 'Тёмно-синий фон, светло-серый текст, васильковый акцент',
    preview: {
      dark: { bg: '#1a1d2e', surface: '#282b3b', accent: '#5b6ed2' },
      light: { bg: '#f0f2f8', surface: '#f3f3f4', accent: '#5a6a9a' },
    },
  },
  {
    id: 'lime',
    title: 'Лайм',
    description: 'Чёрный фон, светло-зелёный текст, лаймовый акцент',
    preview: {
      dark: { bg: '#000000', surface: '#181818', accent: '#7fee64' },
      light: { bg: '#eef7ec', surface: '#f6fbf4', accent: '#2f7d1f' },
    },
  },
  {
    id: 'spark',
    title: 'Искра',
    description: 'Тёмно-фиолетовый фон, сиреневый текст, фиолетовый и оранжевый акценты',
    preview: {
      dark: { bg: '#0e0918', surface: '#1a1624', accent: '#8250f0' },
      light: { bg: '#f5f3f9', surface: '#fbfafd', accent: '#5a1fd0' },
    },
  },
  {
    id: 'monologue',
    title: 'Монолог',
    description: 'Чёрный фон, белый и серый текст, циановый акцент',
    preview: {
      dark: { bg: '#000000', surface: '#191919', accent: '#19d0e8' },
      light: { bg: '#f7f9fa', surface: '#ffffff', accent: '#0b7a8e' },
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
