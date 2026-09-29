import { describe, expect, it } from 'vitest'
import { buildThemeId, DEFAULT_THEME, normalizeTheme, parseThemeId, THEME_FAMILIES } from './themes'

const MODES = ['dark', 'light'] as const

describe('THEME_FAMILIES', () => {
  it('has unique family ids', () => {
    const ids = THEME_FAMILIES.map((family) => family.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('provides previews for both modes', () => {
    for (const family of THEME_FAMILIES) {
      expect(family.preview.dark).toBeDefined()
      expect(family.preview.light).toBeDefined()
    }
  })
})

describe('buildThemeId + parseThemeId', () => {
  it('roundtrips every family in both modes', () => {
    for (const family of THEME_FAMILIES) {
      for (const mode of MODES) {
        const theme = buildThemeId(family.id, mode)
        expect(parseThemeId(theme)).toEqual({ family: family.id, mode })
      }
    }
  })

  it('treats ids without a light suffix as dark', () => {
    expect(parseThemeId('lime')).toEqual({ family: 'lime', mode: 'dark' })
  })

  it('strips only the trailing mode from multi-part families', () => {
    expect(parseThemeId('my-family-light')).toEqual({ family: 'my-family', mode: 'light' })
  })
})

describe('normalizeTheme', () => {
  it('falls back to the default theme for empty values', () => {
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME)
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME)
    expect(normalizeTheme('')).toBe(DEFAULT_THEME)
  })

  it('falls back to the default theme for unknown families', () => {
    expect(normalizeTheme('unknown-dark')).toBe(DEFAULT_THEME)
    expect(normalizeTheme('unknown-light')).toBe(DEFAULT_THEME)
  })

  it('falls back to the default theme for mangled ids', () => {
    expect(normalizeTheme('default-darkx')).toBe(DEFAULT_THEME)
    expect(normalizeTheme('default')).toBe(DEFAULT_THEME)
  })

  it('keeps known themes as is', () => {
    expect(normalizeTheme('lime-light')).toBe('lime-light')
    expect(normalizeTheme('default-dark')).toBe('default-dark')
  })

  it('defaults to the standard dark theme', () => {
    expect(DEFAULT_THEME).toBe('default-dark')
  })
})
