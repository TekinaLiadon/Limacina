import { describe, expect, it } from 'vitest'
import { formatDate, formatNumber } from './formatters'

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
