import { describe, expect, it } from 'vitest'
import { formatCount, formatDate, formatNumber, selectPluralForm, type PluralForms } from '../formatters'

const SYMBOL_FORMS: PluralForms = { one: 'символ', few: 'символа', many: 'символов' }

describe('formatters', () => {
  it('formats numbers with ru-RU separators', () => {
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(1234567).replace(/\D/g, '')).toBe('1234567')
    expect(formatNumber(1234567)).not.toBe('1234567')
  })

  it('formats dates as ru-RU date', () => {
    expect(formatDate('2024-03-05T12:00:00')).toBe('05.03.2024')
  })

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('not-a-date')).toBe('')
  })
})

describe('selectPluralForm', () => {
  it('selects the singular form for counts ending in one', () => {
    expect(selectPluralForm(1, SYMBOL_FORMS)).toBe('символ')
    expect(selectPluralForm(21, SYMBOL_FORMS)).toBe('символ')
    expect(selectPluralForm(101, SYMBOL_FORMS)).toBe('символ')
  })

  it('selects the few form for counts ending in two to four', () => {
    expect(selectPluralForm(2, SYMBOL_FORMS)).toBe('символа')
    expect(selectPluralForm(4, SYMBOL_FORMS)).toBe('символа')
    expect(selectPluralForm(23, SYMBOL_FORMS)).toBe('символа')
  })

  it('selects the many form for zero, five to nine, and the teens', () => {
    expect(selectPluralForm(0, SYMBOL_FORMS)).toBe('символов')
    expect(selectPluralForm(5, SYMBOL_FORMS)).toBe('символов')
    expect(selectPluralForm(9, SYMBOL_FORMS)).toBe('символов')
    expect(selectPluralForm(11, SYMBOL_FORMS)).toBe('символов')
    expect(selectPluralForm(14, SYMBOL_FORMS)).toBe('символов')
    expect(selectPluralForm(111, SYMBOL_FORMS)).toBe('символов')
  })

  it('reuses the few form for fractional counts', () => {
    expect(selectPluralForm(0.5, SYMBOL_FORMS)).toBe('символа')
    expect(selectPluralForm(1.5, SYMBOL_FORMS)).toBe('символа')
  })

  it('prefers an explicit fractional form', () => {
    const forms: PluralForms = { one: 'один', few: 'два', many: 'много', other: 'дробное' }
    expect(selectPluralForm(1.5, forms)).toBe('дробное')
    expect(selectPluralForm(2, forms)).toBe('два')
  })

  it('reads negative counts by their absolute value', () => {
    expect(selectPluralForm(-1, SYMBOL_FORMS)).toBe('символ')
    expect(selectPluralForm(-3, SYMBOL_FORMS)).toBe('символа')
    expect(selectPluralForm(-11, SYMBOL_FORMS)).toBe('символов')
  })

  it('keeps the word forms of the called table', () => {
    const fileForms: PluralForms = { one: 'файл', few: 'файла', many: 'файлов' }
    expect(selectPluralForm(1, fileForms)).toBe('файл')
    expect(selectPluralForm(2, fileForms)).toBe('файла')
    expect(selectPluralForm(12, fileForms)).toBe('файлов')
  })
})

describe('formatCount', () => {
  it('joins the number with the matching word form', () => {
    expect(formatCount(1, SYMBOL_FORMS)).toBe('1 символ')
    expect(formatCount(3, SYMBOL_FORMS)).toBe('3 символа')
    expect(formatCount(12, SYMBOL_FORMS)).toBe('12 символов')
  })

  it('groups large numbers the same way formatNumber does', () => {
    expect(formatCount(1234567, SYMBOL_FORMS)).toBe(`${formatNumber(1234567)} символов`)
  })
})
