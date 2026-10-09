import type { AuthSubTab } from './types'

export const MIN_LOGIN_LENGTH = 4
export const MIN_PASSWORD_LENGTH = 6

export const AUTH_LOGIN_TAB: AuthSubTab = 'login'
export const AUTH_REGISTER_TAB: AuthSubTab = 'register'

const symbolsWord = (count: number): string => {
  const mod100 = count % 100
  if (mod100 >= 11 && mod100 <= 14) return 'символов'
  const mod10 = count % 10
  if (mod10 === 1) return 'символ'
  if (mod10 >= 2 && mod10 <= 4) return 'символа'
  return 'символов'
}

export const minLengthMessage = (min: number): string => `минимум ${min} ${symbolsWord(min)}`

export const isPasswordConfirmed = (password: string, confirmPassword: string): boolean => {
  if (!confirmPassword) return true
  return password === confirmPassword
}
