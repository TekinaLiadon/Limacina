import { describe, expect, it } from 'vitest'
import { MIN_LOGIN_LENGTH, MIN_PASSWORD_LENGTH, isPasswordConfirmed, minLengthMessage } from './authPolicy'

describe('minLengthMessage', () => {
  it('builds the requirement from the actual minimums', () => {
    expect(MIN_LOGIN_LENGTH).toBe(4)
    expect(MIN_PASSWORD_LENGTH).toBe(6)
    expect(minLengthMessage(MIN_LOGIN_LENGTH)).toBe('минимум 4 символа')
    expect(minLengthMessage(MIN_PASSWORD_LENGTH)).toBe('минимум 6 символов')
  })

  it('pluralizes the symbol word', () => {
    expect(minLengthMessage(1)).toBe('минимум 1 символ')
    expect(minLengthMessage(3)).toBe('минимум 3 символа')
    expect(minLengthMessage(5)).toBe('минимум 5 символов')
    expect(minLengthMessage(11)).toBe('минимум 11 символов')
    expect(minLengthMessage(12)).toBe('минимум 12 символов')
    expect(minLengthMessage(14)).toBe('минимум 14 символов')
    expect(minLengthMessage(21)).toBe('минимум 21 символ')
  })
})

describe('isPasswordConfirmed', () => {
  it('treats an empty confirmation as not yet entered', () => {
    expect(isPasswordConfirmed('secret', '')).toBe(true)
  })

  it('matches identical passwords', () => {
    expect(isPasswordConfirmed('secret', 'secret')).toBe(true)
  })

  it('rejects different passwords', () => {
    expect(isPasswordConfirmed('secret', 'other')).toBe(false)
  })
})
