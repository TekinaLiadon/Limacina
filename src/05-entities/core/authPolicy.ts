import type { AuthSubTab } from './types'
import { formatCount, type PluralForms } from '@/06-shared'

export const MIN_LOGIN_LENGTH = 4
export const MIN_PASSWORD_LENGTH = 6

export const AUTH_LOGIN_TAB: AuthSubTab = 'login'
export const AUTH_REGISTER_TAB: AuthSubTab = 'register'

const SYMBOL_FORMS: PluralForms = { one: 'символ', few: 'символа', many: 'символов' }

export const minLengthMessage = (min: number): string => `минимум ${formatCount(min, SYMBOL_FORMS)}`

export const isPasswordConfirmed = (password: string, confirmPassword: string): boolean => {
  if (!confirmPassword) return true
  return password === confirmPassword
}
