export type ThemeMode = 'dark' | 'light'

export interface ThemePreview {
  bg: string
  surface: string
  accent: string
}

export interface ThemeFamily {
  id: string
  title: string
  description: string
  preview: Record<ThemeMode, ThemePreview>
}
